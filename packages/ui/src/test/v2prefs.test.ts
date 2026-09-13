/** VS-350: the V2 Live per-row preference, remembered across reloads. */
import { afterEach, describe, expect, it } from 'vitest';
import { LIVE_COLUMNS_DEFAULT, readLiveColumns, writeLiveColumns } from '../v2/prefs';

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
