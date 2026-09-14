import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTime } from 'ulid';
import { newId } from './db.js';

const COUNT = 64;

describe('newId', () => {
  afterEach(() => vi.useRealTimers());

  it('issues strictly increasing ids within a millisecond', () => {
    // Freeze the clock so the batch is guaranteed to land in one millisecond (VS-392). The
    // assertion this replaced generated a real-clock batch and retried once if the first and last
    // ids straddled a tick; on a loaded CI runner both batches could straddle one, so the test
    // flaked (e.g. `expected 1789358100058 to be 1789358100059`). Freezing the clock tests the
    // same property — the monotonic factory increments its random part rather than repeating, so
    // ids in one millisecond are strictly increasing — without depending on how fast the machine
    // runs 64 calls.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const ids = Array.from({ length: COUNT }, () => newId());
    const ms = decodeTime(ids[0]!);
    for (const id of ids) expect(decodeTime(id)).toBe(ms);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }

    // Across a millisecond boundary the timestamp advances and ordering still holds.
    vi.setSystemTime(1_700_000_000_001);
    const next = newId();
    expect(decodeTime(next)).toBe(ms + 1);
    expect(next > ids.at(-1)!).toBe(true);
  });
});
