/** VS-164: live-page cell spans in sessionStorage (`lib/liveCellSize.ts`). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampSize,
  columnCount,
  isDefaultSize,
  readLiveCellSizes,
  sameSize,
  snapSize,
  writeLiveCellSizes,
} from '../lib/liveCellSize';

const WS = 'ws1';
const KEY = 'conductor.live.cellSizes.ws1';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('columnCount', () => {
  it('is one column below sm, two from sm, three from xl', () => {
    expect(columnCount(false, false)).toBe(1);
    expect(columnCount(true, false)).toBe(2);
    expect(columnCount(true, true)).toBe(3);
    expect(columnCount(false, true)).toBe(3);
  });
});

describe('clampSize', () => {
  it('keeps a legal size, rounded', () => {
    expect(clampSize({ cols: 2.4, rows: 1.6 }, 3)).toEqual({ cols: 2, rows: 2 });
  });

  it('floors at 1×1 and caps to the current column count and 2 rows', () => {
    expect(clampSize({ cols: 0, rows: 0 }, 2)).toEqual({ cols: 1, rows: 1 });
    expect(clampSize({ cols: 9, rows: 9 }, 2)).toEqual({ cols: 2, rows: 2 });
  });

  it('treats expanded as two rows', () => {
    expect(clampSize({ cols: 1, rows: 1, expanded: true }, 1)).toEqual({ cols: 1, rows: 2, expanded: true });
  });
});

describe('snapSize', () => {
  it('grows a column when the pointer crosses one unit of unresized width', () => {
    expect(snapSize({ cols: 1, rows: 1 }, 200, 0, 200, 150, 2)).toEqual({ cols: 2, rows: 1 });
  });

  it('does not move when the pointer has not crossed a span', () => {
    expect(snapSize({ cols: 1, rows: 1 }, 0, 0, 200, 150, 2)).toEqual({ cols: 1, rows: 1 });
    expect(snapSize({ cols: 1, rows: 1 }, 40, 20, 200, 150, 2)).toEqual({ cols: 1, rows: 1 });
  });

  it('stops at the column count and at two rows', () => {
    expect(snapSize({ cols: 1, rows: 1 }, 800, 800, 200, 150, 2)).toEqual({ cols: 2, rows: 2 });
  });

  it('leaves a span alone when the unit is zero (jsdom, no layout)', () => {
    expect(snapSize({ cols: 1, rows: 1 }, 400, 400, 0, 0, 3)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('session map', () => {
  it('opens empty when nothing was remembered', () => {
    expect(readLiveCellSizes(WS)).toEqual({});
  });

  it('reads back a size that was chosen, dropping workers no longer live and default slots', () => {
    const kept = writeLiveCellSizes(
      WS,
      {
        a1: { cols: 2, rows: 1 },
        a2: { cols: 1, rows: 1 },
        gone: { cols: 3, rows: 2 },
      },
      ['a1', 'a2'],
    );
    expect(kept).toEqual({ a1: { cols: 2, rows: 1 } });
    expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify({ a1: { cols: 2, rows: 1 } }));
    expect(readLiveCellSizes(WS)).toEqual({ a1: { cols: 2, rows: 1 } });
  });

  it.each(['abc', '0', '[]', '{"a1":{"cols":"x","rows":1}}', '{"a1":null}'])(
    'reads %o as never resized',
    (stored) => {
      sessionStorage.setItem(KEY, stored);
      expect(readLiveCellSizes(WS)).toEqual({});
    },
  );

  it('is empty when the store cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readLiveCellSizes(WS)).toEqual({});
  });

  it('honours the choice for the session when the store cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => writeLiveCellSizes(WS, { a1: { cols: 2, rows: 1 } }, ['a1'])).not.toThrow();
  });
});

describe('sameSize / isDefaultSize', () => {
  it('treats missing expanded as false', () => {
    expect(sameSize({ cols: 1, rows: 1 }, { cols: 1, rows: 1, expanded: false })).toBe(true);
    expect(isDefaultSize({ cols: 1, rows: 1 })).toBe(true);
    expect(isDefaultSize({ cols: 2, rows: 1 })).toBe(false);
  });
});
