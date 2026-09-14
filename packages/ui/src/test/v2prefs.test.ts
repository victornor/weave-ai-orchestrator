/** VS-350: the V2 Live per-row preference, remembered across reloads. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_COLUMNS_DEFAULT,
  LIVE_HEIGHT_MIN,
  clampLiveHeight,
  maxLiveHeight,
  readLiveColumns,
  readLiveHeight,
  writeLiveColumns,
  writeLiveHeight,
} from '../v2/prefs';

const HEIGHT_KEY = 'weave.v2.live.height';

afterEach(() => localStorage.clear());

describe('the V2 Live columns preference', () => {
  it('defaults to two when nothing is stored', () => {
    expect(readLiveColumns()).toBe(LIVE_COLUMNS_DEFAULT);
  });

  it('round-trips a chosen value', () => {
    writeLiveColumns(3);
    expect(readLiveColumns()).toBe(3);
  });

  it('clamps a written value to the one-to-four range', () => {
    writeLiveColumns(9);
    expect(readLiveColumns()).toBe(4);
    writeLiveColumns(-1);
    expect(readLiveColumns()).toBe(1);
  });

  it('falls back on a junk value', () => {
    localStorage.setItem('weave.v2.live.columns', 'nope');
    expect(readLiveColumns()).toBe(LIVE_COLUMNS_DEFAULT);
  });
});

describe('the V2 Live height preference (VS-372)', () => {
  it('opens on the per-row ladder when nothing was stored', () => {
    expect(readLiveHeight()).toBeNull();
  });

  it('round-trips a chosen height, in whole pixels', () => {
    writeLiveHeight(380);
    expect(localStorage.getItem(HEIGHT_KEY)).toBe('380');
    expect(readLiveHeight()).toBe(380);
    writeLiveHeight(380.6);
    expect(readLiveHeight()).toBe(381);
  });

  it('forgets the key outright when the height is given back', () => {
    writeLiveHeight(380);
    writeLiveHeight(null);
    expect(localStorage.getItem(HEIGHT_KEY)).toBeNull();
    expect(readLiveHeight()).toBeNull();
  });

  it.each(['abc', '0', '-5', ''])('reads %o as never resized', (stored) => {
    localStorage.setItem(HEIGHT_KEY, stored);
    expect(readLiveHeight()).toBeNull();
  });

  it('survives a store that cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readLiveHeight()).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => writeLiveHeight(380)).not.toThrow();
  });

  it('clamps to the minimum and to most of the viewport', () => {
    expect(clampLiveHeight(10, 800)).toBe(LIVE_HEIGHT_MIN);
    expect(clampLiveHeight(5000, 800)).toBe(maxLiveHeight(800));
    expect(maxLiveHeight(800)).toBe(680);
  });

  it('degenerates rather than inverting on a viewport too short for the minimum', () => {
    expect(maxLiveHeight(100)).toBe(LIVE_HEIGHT_MIN);
    expect(clampLiveHeight(5000, 100)).toBe(LIVE_HEIGHT_MIN);
  });
});
