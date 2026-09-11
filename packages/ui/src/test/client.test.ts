import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET_TIMEOUT_MS, NetworkError, SEND_TIMEOUT_MS, request } from '../api/client';

function hangingFetch(): void {
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  })));
}

describe('request timeouts (VS-227)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hangingFetch();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a hanging GET becomes NetworkError after 30s', async () => {
    const pending = request('/api/w/ws1/threads/th_1/messages');
    const assertion = expect(pending).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(GET_TIMEOUT_MS);
    await assertion;
  });

  it('a hanging POST becomes NetworkError after 15s', async () => {
    const pending = request('/api/w/ws1/threads/th_1/messages', { method: 'POST', body: { body: 'hi' } });
    const assertion = expect(pending).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await assertion;
  });

  it('an external abort stays AbortError, not NetworkError', async () => {
    const c = new AbortController();
    const pending = request('/api/x', { signal: c.signal, timeoutMs: 30_000 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    c.abort();
    await assertion;
  });
});
