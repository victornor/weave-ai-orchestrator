import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTime } from 'ulid';
import { newId } from './db.js';

const COUNT = 64;
// Ahead of any real clock: newId is a process-wide monotonic factory that never moves `lastTime` backwards, so a past frozen instant is ignored once any id has already been issued at the real clock.
const BASE = Date.UTC(2030, 0, 1);

function batch(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < COUNT; i++) ids.push(newId());
  return ids;
}

describe('newId', () => {
  afterEach(() => vi.useRealTimers());

  it('issues strictly increasing ids within a millisecond', () => {
    // Freeze the clock so the batch cannot span a tick; the test proves monotonicity, not timing.
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const ids = batch();
    expect(decodeTime(ids[0]!)).toBe(BASE);
    expect(decodeTime(ids.at(-1)!)).toBe(BASE);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it('issues strictly increasing ids across a millisecond boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const before = batch();
    vi.setSystemTime(BASE + 1);
    const after = batch();
    expect(decodeTime(before.at(-1)!)).toBe(BASE);
    expect(decodeTime(after[0]!)).toBe(BASE + 1);
    expect(after[0]! > before.at(-1)!).toBe(true);
    for (let i = 1; i < after.length; i++) {
      expect(after[i]! > after[i - 1]!).toBe(true);
    }
  });
});
