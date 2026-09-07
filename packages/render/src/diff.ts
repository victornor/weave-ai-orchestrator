/**
 * A pure unified-diff parser (VS-107): the same text shape `git diff` and `gh pr diff` both produce,
 * turned into per-file hunks a client can render without re-deriving anything. Used identically
 * whichever source produced the text — the forge or the daemon's own clone — so there is exactly one
 * place that understands the format.
 */

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  /** Line number on the base side, or null for a line the base side does not have (an added line). */
  oldLine: number | null;
  /** Line number on the head side, or null for a line the head side does not have (a removed line). */
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The raw `@@ … @@` line, including any trailing function context git added. */
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiffFile {
  path: string;
  previousPath: string | null;
  status: DiffFileStatus;
  binary: boolean;
  /** The diff carries a `\ No newline at end of file` marker for this file, either side. */
  noNewlineAtEnd: boolean;
  additions: number;
  deletions: number;
  /** `hunks` is `[]` when true: the change is large enough that rendering it costs more than it is worth. */
  tooLarge: boolean;
  hunks: DiffHunk[];
}

/**
 * Above this many changed lines, a file is reported as too large to render rather than parsed in
 * full — generous enough that nothing in this repository's own history trips it, so a normal pull
 * request is unaffected.
 */
export const DIFF_FILE_TOO_LARGE_LINES = 2000;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/;
const DIFF_GIT_LINE = /^diff --git a\/(.*) b\/(.*)$/;

function stripPrefix(path: string): string {
  return path.replace(/^[ab]\//, '');
}

interface MutableFile extends Omit<ParsedDiffFile, 'status'> {
  status: DiffFileStatus | null;
  fallbackPath: string | null;
}

function newFile(): MutableFile {
  return {
    path: '', previousPath: null, status: null, binary: false, noNewlineAtEnd: false,
    additions: 0, deletions: 0, tooLarge: false, hunks: [], fallbackPath: null,
  };
}

function finalize(f: MutableFile): ParsedDiffFile {
  const path = f.path || f.fallbackPath || '';
  const status = f.status ?? 'modified';
  if (f.additions + f.deletions > DIFF_FILE_TOO_LARGE_LINES) {
    return { path, previousPath: f.previousPath, status, binary: f.binary, noNewlineAtEnd: f.noNewlineAtEnd, additions: f.additions, deletions: f.deletions, tooLarge: true, hunks: [] };
  }
  return { path, previousPath: f.previousPath, status, binary: f.binary, noNewlineAtEnd: f.noNewlineAtEnd, additions: f.additions, deletions: f.deletions, tooLarge: false, hunks: f.hunks };
}

/** One PR's (or one `git diff`'s) unified diff text, as every file it touches. */
export function parseUnifiedDiff(text: string): ParsedDiffFile[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ParsedDiffFile[] = [];
  let cur: MutableFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  // How many more base-side and head-side lines the current hunk still expects, per its `@@` header.
  // Once both reach zero the hunk is complete, closed before the next line is looked at — the reason
  // being the trailing blank line every diff ends with (the newline after its last real line, once
  // split) must never be read as one more context line.
  let oldRemaining = 0;
  let newRemaining = 0;

  const closeHunk = (): void => { if (cur && hunk) cur.hunks.push(hunk); hunk = null; };
  const closeFile = (): void => { closeHunk(); if (cur) out.push(finalize(cur)); cur = null; };

  for (const raw of lines) {
    const gitLine = DIFF_GIT_LINE.exec(raw);
    if (gitLine) {
      closeFile();
      cur = newFile();
      cur.fallbackPath = gitLine[2] ?? gitLine[1] ?? '';
      continue;
    }
    if (!cur) continue; // preamble before the first `diff --git`, if any

    if (raw.startsWith('new file mode')) { cur.status = 'added'; continue; }
    if (raw.startsWith('deleted file mode')) { cur.status = 'deleted'; continue; }
    const renameFrom = /^rename from (.*)$/.exec(raw);
    if (renameFrom) { cur.status = 'renamed'; cur.previousPath = renameFrom[1] ?? null; continue; }
    const renameTo = /^rename to (.*)$/.exec(raw);
    if (renameTo) { cur.status = 'renamed'; cur.path = renameTo[1] ?? ''; continue; }

    const binary = /^Binary files (?:a\/(.*)|\/dev\/null) and (?:b\/(.*)|\/dev\/null) differ$/.exec(raw);
    if (binary) {
      cur.binary = true;
      if (binary[2]) cur.path = cur.path || stripPrefix(binary[2]);
      if (binary[1]) cur.fallbackPath = cur.fallbackPath ?? stripPrefix(binary[1]);
      continue;
    }

    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') cur.fallbackPath = cur.fallbackPath ?? stripPrefix(p);
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null' && !cur.path) cur.path = stripPrefix(p);
      continue;
    }

    const hunkHeader = HUNK_HEADER.exec(raw);
    if (hunkHeader) {
      closeHunk();
      oldLine = Number(hunkHeader[1]);
      newLine = Number(hunkHeader[3]);
      oldRemaining = hunkHeader[2] !== undefined ? Number(hunkHeader[2]) : 1;
      newRemaining = hunkHeader[4] !== undefined ? Number(hunkHeader[4]) : 1;
      hunk = {
        oldStart: oldLine, oldLines: oldRemaining, newStart: newLine, newLines: newRemaining,
        header: raw, lines: [],
      };
      continue;
    }

    if (raw.startsWith('\\')) { cur.noNewlineAtEnd = true; continue; }
    if (!hunk) continue; // index/mode lines, and anything past a hunk's own declared line count

    if (raw.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldLine: null, newLine, text: raw.slice(1) });
      newLine += 1; newRemaining -= 1; cur.additions += 1;
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ kind: 'remove', oldLine, newLine: null, text: raw.slice(1) });
      oldLine += 1; oldRemaining -= 1; cur.deletions += 1;
    } else {
      // A context line's marker is a single leading space; git never trims it. Anything else here
      // (an unmarked blank line) can only be the trailing artifact of the file's own final newline.
      hunk.lines.push({ kind: 'context', oldLine, newLine, text: raw.slice(1) });
      oldLine += 1; newLine += 1; oldRemaining -= 1; newRemaining -= 1;
    }
    if (oldRemaining <= 0 && newRemaining <= 0) closeHunk();
  }
  closeFile();
  return out;
}
