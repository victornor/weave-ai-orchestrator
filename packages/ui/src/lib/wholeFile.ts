/**
 * The change explorer's whole-file view (VS-452): a file's hunks and its base-revision content merged
 * into one synthetic hunk a `DiffHunks` renderer draws unchanged.
 *
 * The diff that `GET …/diff/file` returns carries every added and removed line plus three context
 * lines each side of the change; `GET …/diff/file/context` carries the base revision's own lines.
 * Between them the whole file is known: the base fills the unchanged regions before, between and
 * after the hunks, and the hunks supply the changed lines with their own numbering. An added file has
 * no base content, so its hunks (all additions) are the whole file; a deleted file's hunks (all
 * removals) sit over its base content.
 */
import type { DiffFileContent } from '../api/types';
import type { DiffHunk, DiffLine } from '@weave-ai/render';

/**
 * `readFileAtRef` splits `git show`'s stdout on newlines, which leaves one empty entry for the final
 * newline every text file ends with. It is not a line of the file, so it is dropped — exactly once,
 * and only when present.
 */
export function stripTrailingBlank(lines: readonly string[]): string[] {
  if (lines.length && lines[lines.length - 1] === '') return lines.slice(0, -1);
  return [...lines];
}

/**
 * One hunk whose lines cover the whole file, in order. Line numbers are the hunk's own where a line
 * came from one, and the base's (shifted by the running added-minus-removed delta) for the unchanged
 * lines recovered from the base between hunks.
 */
export function wholeFileHunk(file: DiffFileContent, baseLines: readonly string[] | null | undefined): DiffHunk {
  const base = baseLines && baseLines.length ? stripTrailingBlank(baseLines) : null;
  const lines: DiffLine[] = [];
  let cursor = 1;
  let offset = 0;

  for (const hunk of file.hunks) {
    if (base) {
      for (let n = cursor; n <= hunk.oldStart - 1; n++) {
        lines.push({ kind: 'context', oldLine: n, newLine: n + offset, text: base[n - 1] ?? '' });
      }
    }
    for (const line of hunk.lines) lines.push(line);
    cursor = hunk.oldStart + hunk.oldLines;
    offset = hunk.newStart + hunk.newLines - cursor;
  }
  if (base) {
    for (let n = cursor; n <= base.length; n++) {
      lines.push({ kind: 'context', oldLine: n, newLine: n + offset, text: base[n - 1] ?? '' });
    }
  }

  const oldLines = base ? base.length : file.status === 'added' ? 0 : lines.filter((l) => l.oldLine !== null).length;
  const newLines = lines.filter((l) => l.newLine !== null).length;
  return { oldStart: 1, oldLines, newStart: 1, newLines, header: '@@ whole file @@', lines };
}

/** Whether a whole-file view is available at all: a binary or too-large file has no hunks to place. */
export function hasWholeFile(file: DiffFileContent): boolean {
  return !file.binary && !file.tooLarge;
}