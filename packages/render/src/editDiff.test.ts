import { describe, expect, it } from 'vitest';
import { diffHunksForEdits, diffLines } from './editDiff.js';

describe('diffLines', () => {
  it('renders a pure addition as add-only lines', () => {
    const lines = diffLines('a\nb', 'a\nb\nc\nd');
    expect(lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'context', oldLine: 2, newLine: 2, text: 'b' },
      { kind: 'add', oldLine: null, newLine: 3, text: 'c' },
      { kind: 'add', oldLine: null, newLine: 4, text: 'd' },
    ]);
  });

  it('renders a pure removal as remove-only lines', () => {
    const lines = diffLines('a\nb\nc\nd', 'a\nb');
    expect(lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'context', oldLine: 2, newLine: 2, text: 'b' },
      { kind: 'remove', oldLine: 3, newLine: null, text: 'c' },
      { kind: 'remove', oldLine: 4, newLine: null, text: 'd' },
    ]);
  });

  it('renders a mixed change as context, remove and add', () => {
    const lines = diffLines('one\ntwo\nthree', 'one\ntwo changed\nthree');
    expect(lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'one' },
      { kind: 'remove', oldLine: 2, newLine: null, text: 'two' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'two changed' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'three' },
    ]);
  });

  it('renders identical text as all context, no diff', () => {
    const lines = diffLines('same\ntext', 'same\ntext');
    expect(lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'same' },
      { kind: 'context', oldLine: 2, newLine: 2, text: 'text' },
    ]);
    expect(lines.some((l) => l.kind !== 'context')).toBe(false);
  });

  it('drops a single trailing newline from either side without inventing a blank line', () => {
    expect(diffLines('a\n', 'a\n')).toEqual([{ kind: 'context', oldLine: 1, newLine: 1, text: 'a' }]);
  });

  it('handles an empty old text as a pure addition', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { kind: 'add', oldLine: null, newLine: 1, text: 'a' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'b' },
    ]);
  });

  it('handles an empty new text as a pure removal', () => {
    expect(diffLines('a\nb', '')).toEqual([
      { kind: 'remove', oldLine: 1, newLine: null, text: 'a' },
      { kind: 'remove', oldLine: 2, newLine: null, text: 'b' },
    ]);
  });
});

describe('diffHunksForEdits', () => {
  it('produces one hunk per edit pair, in order, numbered from 1', () => {
    const hunks = diffHunksForEdits([
      { oldText: 'a', newText: 'a changed' },
      { oldText: 'b', newText: 'b changed' },
    ]);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, header: '@@ -1,1 +1,1 @@' });
    expect(hunks[0]!.lines).toEqual([
      { kind: 'remove', oldLine: 1, newLine: null, text: 'a' },
      { kind: 'add', oldLine: null, newLine: 1, text: 'a changed' },
    ]);
    expect(hunks[1]!.lines).toEqual([
      { kind: 'remove', oldLine: 1, newLine: null, text: 'b' },
      { kind: 'add', oldLine: null, newLine: 1, text: 'b changed' },
    ]);
  });

  it('returns an empty array for no edits', () => {
    expect(diffHunksForEdits([])).toEqual([]);
  });
});
