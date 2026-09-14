/** The V2 Work FLIP helper's pure diff (VS-426): move, entrance and exit detection. */
import { describe, expect, it } from 'vitest';
import { diffBoxes, type FlipBox } from '../v2/work/flip';

const box = (over: Partial<FlipBox> = {}): FlipBox => ({
  left: 0,
  top: 0,
  width: 236,
  height: 80,
  column: 'todo',
  ...over,
});

const map = (entries: Record<string, FlipBox>): Map<string, FlipBox> => new Map(Object.entries(entries));

describe('diffBoxes', () => {
  it('reports nothing when every box is unchanged', () => {
    const boxes = { a: box(), b: box({ top: 84 }) };
    expect(diffBoxes(map(boxes), map(boxes))).toEqual({ moved: [], entered: [], left: [] });
  });

  it('treats a sub-pixel shuffle as unchanged', () => {
    const prev = map({ a: box({ top: 0 }) });
    const next = map({ a: box({ top: 0.5 }) });
    expect(diffBoxes(prev, next).moved).toEqual([]);
  });

  it('reports a reorder inside a column as a move, not across', () => {
    const prev = map({ a: box({ top: 0 }), b: box({ top: 84 }) });
    const next = map({ a: box({ top: 84 }), b: box({ top: 0 }) });
    expect(diffBoxes(prev, next).moved).toEqual([
      { key: 'a', across: false },
      { key: 'b', across: false },
    ]);
  });

  it('reports a box that changed column as a move across, even at the same coordinates', () => {
    const prev = map({ a: box({ left: 100, column: 'in_progress' }) });
    const next = map({ a: box({ left: 100, column: 'in_review' }) });
    expect(diffBoxes(prev, next).moved).toEqual([{ key: 'a', across: true }]);
  });

  it('separates entrances and exits from moves', () => {
    const prev = map({ old: box() });
    const next = map({ fresh: box() });
    expect(diffBoxes(prev, next)).toEqual({
      moved: [],
      entered: ['fresh'],
      left: ['old'],
    });
  });
});
