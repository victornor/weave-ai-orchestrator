/**
 * Turns an edit tool's before/after text into the same `DiffHunk`/`DiffLine` shape
 * `parseUnifiedDiff` (`diff.ts`) produces from real unified-diff text, so one hunk renderer serves
 * both. An edit tool's payload (Claude `Edit`/`MultiEdit`, opencode `edit`) carries the changed
 * text but never the file offset it came from, so line numbers here count from 1 within the shown
 * snippet — not the file's true line numbers (VS-324 design.md).
 */
import type { DiffHunk, DiffLine } from './diff.js';

/** One edit's before/after text — already extracted from whichever runtime's field names. */
export interface EditPair {
  oldText: string;
  newText: string;
}

/** Above this many cells, the LCS table would be too large to build cheaply; fall back to a
 * trivial diff (every old line removed, every new line added) rather than hang. */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** A line-level LCS diff between two texts. Exact line equality, no move detection — enough to
 * read a small edit snippet, not a general-purpose diff tool. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_LCS_CELLS) {
    const lines: DiffLine[] = [];
    a.forEach((text, i) => lines.push({ kind: 'remove', oldLine: i + 1, newLine: null, text }));
    b.forEach((text, i) => lines.push({ kind: 'add', oldLine: null, newLine: i + 1, text }));
    return lines;
  }

  // dp[i][j] = length of the LCS of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', oldLine, newLine, text: a[i]! });
      i += 1; j += 1; oldLine += 1; newLine += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ kind: 'remove', oldLine, newLine: null, text: a[i]! });
      i += 1; oldLine += 1;
    } else {
      lines.push({ kind: 'add', oldLine: null, newLine, text: b[j]! });
      j += 1; newLine += 1;
    }
  }
  while (i < n) { lines.push({ kind: 'remove', oldLine, newLine: null, text: a[i]! }); i += 1; oldLine += 1; }
  while (j < m) { lines.push({ kind: 'add', oldLine: null, newLine, text: b[j]! }); j += 1; newLine += 1; }
  return lines;
}

/** One `EditPair` → one synthesised `DiffHunk`, its header counting from 1 (see module doc). */
function hunkFor(pair: EditPair): DiffHunk {
  const lines = diffLines(pair.oldText, pair.newText);
  const oldLines = lines.filter((l) => l.kind !== 'add').length;
  const newLines = lines.filter((l) => l.kind !== 'remove').length;
  return {
    oldStart: oldLines > 0 ? 1 : 0,
    oldLines,
    newStart: newLines > 0 ? 1 : 0,
    newLines,
    header: `@@ -1,${oldLines} +1,${newLines} @@`,
    lines,
  };
}

/** One hunk per edit, in call order — a `MultiEdit`'s edits are not reconstructed against each
 * other or against the file (design.md). */
export function diffHunksForEdits(pairs: readonly EditPair[]): DiffHunk[] {
  return pairs.map(hunkFor);
}
