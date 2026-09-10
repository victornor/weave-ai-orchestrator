/** VS-164: live-page cell spans in sessionStorage (`lib/liveCellSize.ts`). VS-206: fine tracks. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampSize,
  columnCount,
  DEFAULT_SIZE,
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
  it('is GRANULARITY×GRANULARITY, matching the current default', () => {
    expect(DEFAULT_SIZE).toEqual({ cols: 4, rows: 4 });
    expect(isDefaultSize(DEFAULT_SIZE)).toBe(true);
  });

  it('sizeOf returns the equal slot for a worker with no stored size, under any colsMax', () => {
    expect(sizeOf({}, 'nobody', columnCount(false, false))).toEqual(DEFAULT_SIZE);
    expect(sizeOf({}, 'nobody', columnCount(true, false))).toEqual(DEFAULT_SIZE);
    expect(sizeOf({}, 'nobody', columnCount(true, true))).toEqual(DEFAULT_SIZE);
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
        a1: { cols: 6, rows: 3 },
        a2: { ...DEFAULT_SIZE },
        gone: { cols: 9, rows: 5 },
      },
      ['a1', 'a2'],
    );
    expect(kept).toEqual({ a1: { cols: 6, rows: 3 } });
    expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify({ a1: { cols: 6, rows: 3 } }));
    expect(readLiveCellSizes(WS)).toEqual({ a1: { cols: 6, rows: 3 } });
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
    expect(isDefaultSize({ ...DEFAULT_SIZE })).toBe(true);
    expect(isDefaultSize({ cols: DEFAULT_SIZE.cols + 1, rows: DEFAULT_SIZE.rows })).toBe(false);
  });
});
