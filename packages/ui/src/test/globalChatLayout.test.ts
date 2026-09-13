/**
 * VS-336: the global Chats pane layout model (`lib/globalChatLayout.ts`) — weights, order,
 * collapsed state, reconciliation, drag/keyboard mutations and localStorage persistence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEIGHT,
  canCollapse,
  emptyLayout,
  expandedIds,
  isCollapsed,
  MIN_SPLIT,
  movePane,
  nearestExpanded,
  placePane,
  readGlobalChatLayout,
  reconcileLayout,
  resetPair,
  sameLayout,
  setPairSplit,
  toggleCollapsed,
  weightOf,
  writeGlobalChatLayout,
  type GlobalChatLayout,
} from '../lib/globalChatLayout';

const KEY = 'conductor.globalChats.layout';

function layout(partial: Partial<GlobalChatLayout>): GlobalChatLayout {
  return { order: [], widths: {}, collapsed: {}, ...partial };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('weightOf', () => {
  it('defaults a missing or invalid weight', () => {
    expect(weightOf({}, 'a')).toBe(DEFAULT_WEIGHT);
    expect(weightOf({ a: 0 }, 'a')).toBe(DEFAULT_WEIGHT);
    expect(weightOf({ a: -2 }, 'a')).toBe(DEFAULT_WEIGHT);
    expect(weightOf({ a: Number.NaN }, 'a')).toBe(DEFAULT_WEIGHT);
    expect(weightOf({ a: 3.5 }, 'a')).toBe(3.5);
  });
});

describe('reconcileLayout', () => {
  it('drops a removed workspace and keeps the rest', () => {
    const saved = layout({
      order: ['a', 'gone', 'b'],
      widths: { a: 2, gone: 5, b: 1 },
      collapsed: { gone: true, b: true },
    });
    expect(reconcileLayout(saved, ['a', 'b'])).toEqual({
      order: ['a', 'b'],
      widths: { a: 2, b: 1 },
      collapsed: { b: true },
    });
  });

  it('appends a new workspace expanded at the default weight', () => {
    const saved = layout({ order: ['a'], widths: { a: 2 }, collapsed: {} });
    expect(reconcileLayout(saved, ['a', 'b'])).toEqual({
      order: ['a', 'b'],
      widths: { a: 2, b: DEFAULT_WEIGHT },
      collapsed: {},
    });
  });

  it('honours the daemon order for ids it has never seen', () => {
    const saved = layout({ order: ['b'], widths: {}, collapsed: {} });
    expect(reconcileLayout(saved, ['a', 'b', 'c']).order).toEqual(['b', 'a', 'c']);
  });

  it('keeps at least one pane expanded when all saved as collapsed', () => {
    const saved = layout({ order: ['a', 'b'], widths: {}, collapsed: { a: true, b: true } });
    const next = reconcileLayout(saved, ['a', 'b']);
    expect(expandedIds(next)).toHaveLength(1);
    expect(isCollapsed(next, 'a')).toBe(false);
  });

  it('is a no-op shape for an unchanged list (sameLayout)', () => {
    const saved = layout({ order: ['a', 'b'], widths: { a: 2 }, collapsed: {} });
    expect(sameLayout(saved, reconcileLayout(saved, ['a', 'b']))).toBe(true);
  });
});

describe('movePane', () => {
  it('moves one position and bounds at the ends', () => {
    expect(movePane(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movePane(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(movePane(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(movePane(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(movePane(['a', 'b', 'c'], 'missing', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('placePane', () => {
  it('moves a pane forward and backward to a drop index in the current order', () => {
    expect(placePane(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a']);
    expect(placePane(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(placePane(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('setPairSplit / resetPair', () => {
  it('moves weight between the two neighbours only', () => {
    const next = setPairSplit({ a: 4, b: 4, c: 9 }, 'a', 'b', 6);
    expect(weightOf(next, 'a')).toBeCloseTo(6);
    expect(weightOf(next, 'b')).toBeCloseTo(2);
    expect(weightOf(next, 'c')).toBe(9);
    expect(weightOf(next, 'a') + weightOf(next, 'b')).toBeCloseTo(8);
  });

  it('clamps each side to the minimum split of the pair', () => {
    const far = setPairSplit({ a: 4, b: 4 }, 'a', 'b', 100);
    expect(weightOf(far, 'a')).toBeCloseTo(8 - 8 * MIN_SPLIT);
    expect(weightOf(far, 'b')).toBeCloseTo(8 * MIN_SPLIT);
    const back = setPairSplit({ a: 4, b: 4 }, 'a', 'b', -100);
    expect(weightOf(back, 'a')).toBeCloseTo(8 * MIN_SPLIT);
    expect(weightOf(back, 'b')).toBeCloseTo(8 - 8 * MIN_SPLIT);
  });

  it('reset splits the pair evenly', () => {
    expect(resetPair({ a: 7, b: 1 }, 'a', 'b')).toEqual({ a: 4, b: 4 });
  });
});

describe('collapse', () => {
  it('collapses an expanded pane while another stays expanded', () => {
    const next = toggleCollapsed(layout({ order: ['a', 'b'], collapsed: {} }), 'a');
    expect(isCollapsed(next, 'a')).toBe(true);
    expect(canCollapse(next, 'b')).toBe(false);
  });

  it('refuses to collapse the last expanded pane', () => {
    const one = layout({ order: ['a', 'b'], collapsed: { a: true } });
    expect(toggleCollapsed(one, 'b')).toEqual(one);
  });

  it('expands a collapsed pane', () => {
    const next = toggleCollapsed(layout({ order: ['a', 'b'], collapsed: { a: true } }), 'a');
    expect(isCollapsed(next, 'a')).toBe(false);
  });
});

describe('nearestExpanded', () => {
  it('prefers the previous expanded pane, then the next', () => {
    const two = layout({ order: ['a', 'b', 'c'], collapsed: { b: true } });
    expect(nearestExpanded(two, 'b')).toBe('a');
    const onlyRight = layout({ order: ['a', 'b', 'c'], collapsed: { a: true, b: true } });
    expect(nearestExpanded(onlyRight, 'b')).toBe('c');
  });
});

describe('localStorage persistence', () => {
  it('round-trips order, widths and collapsed state', () => {
    const saved = layout({ order: ['b', 'a'], widths: { b: 3, a: 1 }, collapsed: { a: true } });
    writeGlobalChatLayout(saved, ['a', 'b']);
    expect(readGlobalChatLayout()).toEqual(saved);
  });

  it('reads and writes a caller-supplied key independently of V1\'s', () => {
    const saved = layout({ order: ['a'], widths: { a: 2 } });
    writeGlobalChatLayout(saved, ['a'], 'weave.v2.chats.layout');
    expect(readGlobalChatLayout('weave.v2.chats.layout')).toEqual(saved);
    expect(readGlobalChatLayout()).toEqual(emptyLayout());
  });

  it('prunes ids the daemon no longer lists when writing', () => {    const saved = layout({ order: ['a', 'gone'], widths: { a: 2, gone: 5 }, collapsed: { gone: true } });
    writeGlobalChatLayout(saved, ['a']);
    expect(readGlobalChatLayout()).toEqual({ order: ['a'], widths: { a: 2 }, collapsed: {} });
  });

  it('degrades to an empty layout on unreadable or wrongly-typed storage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readGlobalChatLayout()).toEqual(emptyLayout());
    localStorage.setItem(KEY, JSON.stringify({ order: ['a', 3, 'a'], widths: { a: 'x', b: -1 }, collapsed: { a: 'yes' } }));
    expect(readGlobalChatLayout()).toEqual({ order: ['a'], widths: {}, collapsed: {} });
  });

  it('still works when storage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readGlobalChatLayout()).toEqual(emptyLayout());
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => writeGlobalChatLayout(layout({ order: ['a'] }), ['a'])).not.toThrow();
    set.mockRestore();
  });
});
