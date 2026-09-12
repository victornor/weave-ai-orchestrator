/**
 * A dependency-free ZIP container writer (VS-273, openspec design.md — Decision 4). Node's `node:zlib`
 * supplies `crc32()` and raw deflate but no ZIP *container* format; this writes one using the `store`
 * method (method 0, no compression) rather than deflate, so the local/central header bookkeeping stays
 * the simple, universally-supported subset of the format — every reader accepts `store`.
 */
import { crc32 } from 'node:zlib';
import { basename, dirname } from 'node:path';

export interface ZipEntry { name: string; bytes: Uint8Array }

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 11: filenames are UTF-8, not the legacy code page. */
const UTF8_NAME_FLAG = 0x0800;
/** 2.0 — the minimum version that knows about the `store` method. */
const VERSION = 20;
/** Unix regular file, `rw-r--r--`, placed in the upper 16 bits of external file attributes. */
const UNIX_REGULAR_FILE_RW_R_R = 0o100644 * 65536;

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** Builds a valid ZIP archive from entries already given sensible, disambiguated internal names. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.bytes);
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAME_FLAG, 6);
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size == uncompressed size (store)
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION, 4); // version made by
    central.writeUInt16LE(VERSION, 6); // version needed to extract
    central.writeUInt16LE(UTF8_NAME_FLAG, 8);
    central.writeUInt16LE(0, 10); // method: store
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(UNIX_REGULAR_FILE_RW_R_R, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // offset of this entry's local header
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralDirOffset = offset;
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory start
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/**
 * Chooses a sensible, collision-free internal path for each source path, in the order given: the base
 * name first, then the immediate parent directory prefixed onto it, then a numeric suffix — the
 * escalation openspec design.md — Decision 7 describes for "several files with the same base name".
 */
export function zipEntryNamesFor(paths: string[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const p of paths) {
    const base = basename(p);
    let candidate = base;
    if (used.has(candidate)) {
      const parent = basename(dirname(p));
      candidate = parent ? `${parent}/${base}` : base;
    }
    if (used.has(candidate)) {
      const dot = candidate.lastIndexOf('.');
      const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
      const ext = dot > 0 ? candidate.slice(dot) : '';
      let n = 2;
      let attempt = `${stem}-${n}${ext}`;
      while (used.has(attempt)) { n += 1; attempt = `${stem}-${n}${ext}`; }
      candidate = attempt;
    }
    used.add(candidate);
    names.set(p, candidate);
  }
  return names;
}
