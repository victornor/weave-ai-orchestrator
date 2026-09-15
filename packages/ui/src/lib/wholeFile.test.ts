import { describe, expect, it } from 'vitest';
import { hasWholeFile, stripTrailingBlank, wholeFileHunk } from './wholeFile';
import type { DiffFileContent } from '../api/types';
import type { DiffHunk, DiffLine } from '@weave-ai/render';

function content(over: Partial<DiffFileContent> & { path: string }): DiffFileContent {
  return { previousPath: null, status: 'modified', additions: 0, deletions: 0, binary: false, tooLarge: false, hunks: [], ...over };
}

function hunk(oldStart: number, oldLines: number, newStart: number, newLines: number, lines: DiffLine[]): DiffHunk {
  return { oldStart, oldLines, newStart, newLines, header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, lines };
}

const kindOf = (lines: DiffLine[]): string[] => lines.map((l) => l.kind);
const textOf = (lines: DiffLine[]): string[] => lines.map((l) => l.text);

describe('stripTrailingBlank', () => {
  it('drops the one empty entry the trailing newline leaves', () => {
    expect(stripTrailingBlank(['a', 'b', ''])).toEqual(['a', 'b']);
  });

  it('leaves a file whose last line has no newline alone', () => {
    expect(stripTrailingBlank(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('leaves a genuinely empty file as one empty line', () => {
    expect(stripTrailingBlank([''])).toEqual([]);
  });
});

describe('wholeFileHunk', () => {
  it('fills the gap between two hunks from the base, with the base line numbers', () => {
    const file = content({
      path: 'src/a.ts',
      hunks: [
        hunk(2, 1, 2, 1, [
          { kind: 'remove', oldLine: 2, newLine: null, text: 'l2' },
          { kind: 'add', oldLine: null, newLine: 2, text: 'L2' },
        ]),
        hunk(5, 1, 5, 1, [
          { kind: 'remove', oldLine: 5, newLine: null, text: 'l5' },
          { kind: 'add', oldLine: null, newLine: 5, text: 'L5' },
        ]),
      ],
    });
    const whole = wholeFileHunk(file, ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    expect(kindOf(whole.lines)).toEqual(['context', 'remove', 'add', 'context', 'context', 'remove', 'add', 'context']);
    expect(textOf(whole.lines)).toEqual(['l1', 'l2', 'L2', 'l3', 'l4', 'l5', 'L5', 'l6']);
    expect(whole.lines[0]).toMatchObject({ oldLine: 1, newLine: 1 });
    expect(whole.lines[3]).toMatchObject({ oldLine: 3, newLine: 3 });
    expect(whole.lines[7]).toMatchObject({ oldLine: 6, newLine: 6 });
  });

  it('shifts the new-side numbers of context after an insertion', () => {
    const file = content({
      path: 'src/a.ts',
      hunks: [hunk(1, 2, 1, 3, [
        { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
        { kind: 'add', oldLine: null, newLine: 2, text: 'X' },
        { kind: 'context', oldLine: 2, newLine: 3, text: 'b' },
      ])],
    });
    const whole = wholeFileHunk(file, ['a', 'b', 'c']);
    expect(textOf(whole.lines)).toEqual(['a', 'X', 'b', 'c']);
    expect(whole.lines[3]).toMatchObject({ oldLine: 3, newLine: 4 });
  });

  it('is the hunks themselves for an added file, which has no base content', () => {
    const file = content({
      path: 'src/new.ts', status: 'added', additions: 2,
      hunks: [hunk(0, 0, 1, 2, [
        { kind: 'add', oldLine: null, newLine: 1, text: 'x' },
        { kind: 'add', oldLine: null, newLine: 2, text: 'y' },
      ])],
    });
    for (const base of [null, [] as string[]]) {
      const whole = wholeFileHunk(file, base);
      expect(kindOf(whole.lines)).toEqual(['add', 'add']);
      expect(textOf(whole.lines)).toEqual(['x', 'y']);
    }
  });

  it('is the base content, all removed, for a deleted file', () => {
    const file = content({
      path: 'src/gone.ts', status: 'deleted', deletions: 2,
      hunks: [hunk(1, 2, 0, 0, [
        { kind: 'remove', oldLine: 1, newLine: null, text: 'a' },
        { kind: 'remove', oldLine: 2, newLine: null, text: 'b' },
      ])],
    });
    const whole = wholeFileHunk(file, ['a', 'b']);
    expect(kindOf(whole.lines)).toEqual(['remove', 'remove']);
  });

  it('is the base content for a rename with no hunks', () => {
    const file = content({ path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' });
    const whole = wholeFileHunk(file, ['a', 'b']);
    expect(kindOf(whole.lines)).toEqual(['context', 'context']);
    expect(textOf(whole.lines)).toEqual(['a', 'b']);
  });

  it('leaves a file with no base and no hunks empty rather than throwing', () => {
    const whole = wholeFileHunk(content({ path: 'src/a.ts' }), null);
    expect(whole.lines).toEqual([]);
  });
});

describe('hasWholeFile', () => {
  it('is false for a binary or too-large file, which has no hunks', () => {
    expect(hasWholeFile(content({ path: 'a.png', binary: true }))).toBe(false);
    expect(hasWholeFile(content({ path: 'a.ts', tooLarge: true }))).toBe(false);
    expect(hasWholeFile(content({ path: 'a.ts' }))).toBe(true);
  });
});