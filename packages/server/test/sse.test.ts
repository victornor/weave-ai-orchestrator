/**
 * VS-641: the SSE keepalive and write-liveness contract. The heartbeat must be a named event a
 * browser watchdog can observe (not an SSE comment), and a stalled write must end the stream.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SSEStreamingApi } from 'hono/streaming';
import { heartbeat, writeSse } from '../src/sse.js';

interface FakeStream {
  writes: unknown[];
  aborted: boolean;
  writeSSE: (frame: unknown) => Promise<void>;
  abort: () => void;
}

function fakeStream(writeSSE?: (frame: unknown) => Promise<void>): FakeStream {
  const stream: FakeStream = {
    writes: [],
    aborted: false,
    writeSSE: writeSSE ?? ((frame) => { stream.writes.push(frame); return Promise.resolve(); }),
    abort() { stream.aborted = true; },
  };
  return stream;
}

const asStream = (s: FakeStream): SSEStreamingApi => s as unknown as SSEStreamingApi;

describe('writeSse', () => {
  it('returns true when the write completes', async () => {
    const s = fakeStream();
    await expect(writeSse(asStream(s), () => s.writeSSE({ event: 'x' }))).resolves.toBe(true);
    expect(s.writes).toHaveLength(1);
    expect(s.aborted).toBe(false);
  });

  it('returns false when the write rejects', async () => {
    const s = fakeStream(() => Promise.reject(new Error('gone')));
    await expect(writeSse(asStream(s), () => s.writeSSE({}))).resolves.toBe(false);
  });

  it('aborts and returns false when the write stalls past the timeout', async () => {
    vi.useFakeTimers();
    try {
      const s = fakeStream(() => new Promise<void>(() => {}));
      const pending = writeSse(asStream(s), () => s.writeSSE({}), 1000);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBe(false);
      expect(s.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('heartbeat', () => {
  it('writes a named heartbeat event with a timestamp and no id', async () => {
    const s = fakeStream();
    await expect(heartbeat(asStream(s))).resolves.toBe(true);
    expect(s.writes).toHaveLength(1);
    const frame = s.writes[0] as { event?: string; id?: string; data?: string };
    expect(frame.event).toBe('heartbeat');
    expect(frame.id).toBeUndefined();
    expect(JSON.parse(frame.data ?? '{}')).toMatchObject({ at: expect.any(String) });
  });
});
