/**
 * Minimal QR encoder (byte mode, ECC level M, versions 1–10) used to render
 * the TOTP otpauth URL inline as SVG. The otpauth URL and the secret are
 * always shown beneath it as the text fallback.
 */

const EC_CODEWORDS_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const EC_BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ALIGN_POS: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/* GF(256) tables */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j]! ^ mul(poly[j]!, EXP[i]!)) as number;
      next[j + 1] = (next[j + 1]! ^ poly[j]!) as number;
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0]!;
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i++) res[i] = (res[i]! ^ mul(gen[i + 1]!, factor)) as number;
  }
  return res;
}

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const total = TOTAL_CODEWORDS[v]!;
    const ec = EC_CODEWORDS_M[v]! * EC_BLOCKS_M[v]!;
    const capacityBits = (total - ec) * 8;
    const headerBits = 4 + (v < 10 ? 8 : 16);
    if (headerBits + byteLen * 8 <= capacityBits) return v;
  }
  throw new Error('QR payload too large');
}

function bitsToCodewords(data: Uint8Array, version: number): Uint8Array {
  const total = TOTAL_CODEWORDS[version]!;
  const ecTotal = EC_CODEWORDS_M[version]! * EC_BLOCKS_M[version]!;
  const dataLen = total - ecTotal;
  const bits: number[] = [];
  const push = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(data.length, version < 10 ? 8 : 16);
  for (const b of data) push(b, 8);
  const cap = dataLen * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out = new Uint8Array(dataLen);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j]!;
    out[i] = byte;
  }
  let pad = 0xec;
  for (let i = bits.length / 8; i < dataLen; i++) {
    out[i] = pad;
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return out;
}

function interleave(dataCodewords: Uint8Array, version: number): Uint8Array {
  const blocks = EC_BLOCKS_M[version]!;
  const ecLen = EC_CODEWORDS_M[version]!;
  const shortLen = Math.floor(dataCodewords.length / blocks);
  const longCount = dataCodewords.length % blocks;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let off = 0;
  for (let i = 0; i < blocks; i++) {
    const len = shortLen + (i >= blocks - longCount ? 1 : 0);
    const chunk = dataCodewords.slice(off, off + len);
    off += len;
    dataBlocks.push(chunk);
    ecBlocks.push(rsEncode(chunk, ecLen));
  }
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]!);
  return new Uint8Array(out);
}

type Grid = Int8Array[]; // -1 = free, 0/1 = module

function newGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
}

function placeFinder(g: Grid, r: number, c: number): void {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= g.length || cc >= g.length) continue;
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark = inRing && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      g[rr]![cc] = dark ? 1 : 0;
    }
  }
}

function reserveFormat(g: Grid): void {
  const n = g.length;
  for (let i = 0; i < 9; i++) {
    if (g[8]![i] === -1) g[8]![i] = 0;
    if (g[i]![8] === -1) g[i]![8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (g[8]![n - 1 - i] === -1) g[8]![n - 1 - i] = 0;
    if (g[n - 1 - i]![8] === -1) g[n - 1 - i]![8] = 0;
  }
  g[n - 8]![8] = 1; // dark module
}

function buildMatrix(codewords: Uint8Array, version: number): { grid: Grid; mask: number } {
  const size = version * 4 + 17;
  const g = newGrid(size);

  placeFinder(g, 0, 0);
  placeFinder(g, 0, size - 7);
  placeFinder(g, size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (g[6]![i] === -1) g[6]![i] = v;
    if (g[i]![6] === -1) g[i]![6] = v;
  }

  for (const r of ALIGN_POS[version]!) {
    for (const c of ALIGN_POS[version]!) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          g[r + dr]![c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
        }
      }
    }
  }

  reserveFormat(g);

  // Data placement, two-column zigzag from the bottom-right.
  let bitIndex = 0;
  const bitAt = (i: number): number => {
    const byte = codewords[i >> 3];
    return byte === undefined ? 0 : (byte >> (7 - (i & 7))) & 1;
  };
  const dataCells: Array<[number, number]> = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (g[row]![c] === -1) {
          g[row]![c] = bitAt(bitIndex) as -1 | 0 | 1 as number;
          dataCells.push([row, c]);
          bitIndex++;
        }
      }
    }
    upward = !upward;
  }

  // Choose the mask with the lowest penalty.
  let best = 0;
  let bestScore = Infinity;
  let bestGrid: Grid = g;
  for (let m = 0; m < 8; m++) {
    const cand = g.map((row) => Int8Array.from(row));
    for (const [r, c] of dataCells) if (maskBit(m, r, c)) cand[r]![c] = (cand[r]![c]! ^ 1) as number;
    writeFormat(cand, m);
    const score = penalty(cand);
    if (score < bestScore) {
      bestScore = score;
      best = m;
      bestGrid = cand;
    }
  }
  return { grid: bestGrid, mask: best };
}

function maskBit(m: number, r: number, c: number): boolean {
  switch (m) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function writeFormat(g: Grid, mask: number): void {
  const n = g.length;
  const data = (0b00 << 3) | mask; // EC level M = 0b00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): number => (bits >> i) & 1;

  for (let i = 0; i <= 5; i++) g[8]![i] = bit(i);
  g[8]![7] = bit(6);
  g[8]![8] = bit(7);
  g[7]![8] = bit(8);
  for (let i = 9; i < 15; i++) g[14 - i]![8] = bit(i);

  for (let i = 0; i <= 7; i++) g[n - 1 - i]![8] = bit(i);
  for (let i = 8; i < 15; i++) g[8]![n - 15 + i] = bit(i);
  g[n - 8]![8] = 1;
}

function penalty(g: Grid): number {
  const n = g.length;
  let score = 0;
  const runScore = (run: number): number => (run >= 5 ? run - 2 : 0);
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (g[r]![c] === g[r]![c - 1]) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (g[r]![c] === g[r - 1]![c]) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const v = g[r]![c];
      if (v === g[r]![c + 1] && v === g[r + 1]![c] && v === g[r + 1]![c + 1]) score += 3;
    }
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (g[r]![c] === 1) dark++;
  const ratio = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/** Encode `text` and return a square matrix of booleans (true = dark). */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length);
  const codewords = interleave(bitsToCodewords(bytes, version), version);
  const { grid } = buildMatrix(codewords, version);
  return grid.map((row) => Array.from(row, (v) => v === 1));
}

/** A ready-made SVG path for the dark modules, with a 4-module quiet zone. */
export function qrSvgPath(matrix: boolean[][], quiet = 4): { path: string; size: number } {
  const n = matrix.length;
  const size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (matrix[r]![c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return { path: d, size };
}
