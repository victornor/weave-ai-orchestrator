/**
 * VS-164: live-page cell spans in sessionStorage (`lib/liveCellSize.ts`). VS-206: fine tracks.
 * VS-324: the never-resized default becomes breakpoint-aware (half the grid at `sm`/`xl`, full
 * width at phone) instead of a flat `GRANULARITY×GRANULARITY` constant.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampSize,
  columnCount,
  defaultSize,
  isDefaultSize,
  readLiveCellSizes,
  ROWS_MAX,
  sameSize,
  sizeOf,
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
  it('is four tracks below sm, eight from sm, twelve from xl (GRANULARITY=4)', () => {
    expect(columnCount(false, false)).toBe(4);
    expect(columnCount(true, false)).toBe(8);
    expect(columnCount(true, true)).toBe(12);
    expect(columnCount(false, true)).toBe(12);
  });
});

describe('clampSize', () => {
  it('keeps a legal size, rounded', () => {
    expect(clampSize({ cols: 2.4, rows: 1.6 }, 3)).toEqual({ cols: 2, rows: 2 });
  });

  it('floors at 1×1 and caps to the passed column count and ROWS_MAX rows', () => {
    expect(clampSize({ cols: 0, rows: 0 }, 2)).toEqual({ cols: 1, rows: 1 });
    expect(clampSize({ cols: 9, rows: 9 }, 2)).toEqual({ cols: 2, rows: ROWS_MAX });
  });

  it('treats expanded as ROWS_MAX rows', () => {
    expect(clampSize({ cols: 1, rows: 1, expanded: true }, 1)).toEqual({ cols: 1, rows: ROWS_MAX, expanded: true });
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

  it('stops at the column count and at the row max', () => {
    expect(snapSize({ cols: 1, rows: 1 }, 800, 2000, 200, 150, 2)).toEqual({ cols: 2, rows: ROWS_MAX });
  });

  it('leaves a span alone when the unit is zero (jsdom, no layout)', () => {
    expect(snapSize({ cols: 1, rows: 1 }, 400, 400, 0, 0, 3)).toEqual({ cols: 1, rows: 1 });
  });

  it('reaches at least twelve distinct widths at xl (reads as continuous)', () => {
    const colsMax = columnCount(true, true);
    const widths = new Set<number>();
    for (let dx = -colsMax * 200; dx <= colsMax * 200; dx += 200) {
      widths.add(snapSize({ cols: 1, rows: 1 }, dx, 0, 200, 150, colsMax).cols);
    }
    expect(widths.size).toBeGreaterThanOrEqual(12);
  });
});

describe('the equal slot', () => {
  it('is half the grid width at sm and xl, and the full grid width at phone (VS-324)', () => {
    expect(defaultSize(false, columnCount(false, false))).toEqual({ cols: 4, rows: 4 }); // phone: 4 of 4
    expect(defaultSize(true, columnCount(true, false))).toEqual({ cols: 4, rows: 4 }); // sm: 4 of 8
    expect(defaultSize(true, columnCount(true, true))).toEqual({ cols: 6, rows: 4 }); // xl: 6 of 12
  });

  it('sizeOf returns the equal slot for a worker with no stored size, under any breakpoint', () => {
    expect(sizeOf({}, 'nobody', false, columnCount(false, false))).toEqual({ cols: 4, rows: 4 });
    expect(sizeOf({}, 'nobody', true, columnCount(true, false))).toEqual({ cols: 4, rows: 4 });
    expect(sizeOf({}, 'nobody', true, columnCount(true, true))).toEqual({ cols: 6, rows: 4 });
  });

  it('isDefaultSize is breakpoint-aware: six cols is default at xl but an explicit resize at sm', () => {
    expect(isDefaultSize({ cols: 6, rows: 4 }, true, columnCount(true, true))).toBe(true);
    expect(isDefaultSize({ cols: 6, rows: 4 }, true, columnCount(true, false))).toBe(false);
  });
});

describe('session map', () => {
  it('opens empty when nothing was remembered', () => {
    expect(readLiveCellSizes(WS)).toEqual({});
  });

  it('reads back a size that was chosen, dropping workers no longer live and default slots', () => {
    const colsMax = columnCount(true, false); // sm: default is {cols: 4, rows: 4}
    const kept = writeLiveCellSizes(
      WS,
      {
        a1: { cols: 6, rows: 3 },
        a2: { cols: 4, rows: 4 },
        gone: { cols: 9, rows: 5 },
      },
      ['a1', 'a2'],
      true,
      colsMax,
    );
    expect(kept).toEqual({ a1: { cols: 6, rows: 3 } });
    expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify({ a1: { cols: 6, rows: 3 } }));
    expect(readLiveCellSizes(WS)).toEqual({ a1: { cols: 6, rows: 3 } });
  });

  it('drops the xl default (6 of 12), not the old flat default (4 of 12)', () => {
    const colsMax = columnCount(true, true);
    const kept = writeLiveCellSizes(WS, { a1: { cols: 6, rows: 4 }, a2: { cols: 4, rows: 4 } }, ['a1', 'a2'], true, colsMax);
    // a1 is the new xl default and is dropped; a2 (the old flat default) is now a genuine resize and kept.
    expect(kept).toEqual({ a2: { cols: 4, rows: 4 } });
  });

  it('keeps a size saved before this change exactly as it was (VS-324: no migration needed)', () => {
    // Any size other than the breakpoint's own default already survived the old writeLiveCellSizes
    // (which stripped only the flat 4x4 default at every breakpoint) and keeps surviving the new,
    // breakpoint-aware one on the same terms.
    const colsMax = columnCount(true, true);
    const preExisting = { a1: { cols: 5, rows: 4 } };
    expect(writeLiveCellSizes(WS, preExisting, ['a1'], true, colsMax)).toEqual(preExisting);
    expect(sizeOf(preExisting, 'a1', true, colsMax)).toEqual({ cols: 5, rows: 4 });
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
    expect(() => writeLiveCellSizes(WS, { a1: { cols: 2, rows: 1 } }, ['a1'], true, columnCount(true, false))).not.toThrow();
  });
});

describe('sameSize / isDefaultSize', () => {
  it('treats missing expanded as false', () => {
    expect(sameSize({ cols: 1, rows: 1 }, { cols: 1, rows: 1, expanded: false })).toBe(true);
    const colsMax = columnCount(true, false);
    expect(isDefaultSize({ cols: 4, rows: 4 }, true, colsMax)).toBe(true);
    expect(isDefaultSize({ cols: 5, rows: 4 }, true, colsMax)).toBe(false);
  });
});
