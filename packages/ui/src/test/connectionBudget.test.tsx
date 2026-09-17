/**
 * VS-227: HTTP/1.1 leaves about six connections per origin. Persistent EventSources that ignore
 * `document.hidden` fill the cap and starve GET /threads and POST /messages.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStream } from '../api/events';
import { FanInStreams } from '../api/context';
import { request, NetworkError } from '../api/client';
import { render } from '@testing-library/react';
import { resetGlobalStream } from '../api/streams';
import { resetDocumentVisible, setDocumentHidden } from './visibility';

const CAP = 6;

class CappedEventSource {
  static open: CappedEventSource[] = [];
  static used = 0;
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  held = false;

  constructor(readonly url: string) {
    CappedEventSource.open.push(this);
    if (CappedEventSource.used < CAP) {
      CappedEventSource.used += 1;
      this.held = true;
    }
  }
  addEventListener(): void { /* named SSE types */ }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.held) {
      CappedEventSource.used -= 1;
      this.held = false;
    }
  }
}

beforeEach(() => {
  CappedEventSource.open = [];
  CappedEventSource.used = 0;
  resetDocumentVisible();
  (globalThis as unknown as { EventSource: unknown }).EventSource = CappedEventSource;
});
afterEach(() => {
  resetGlobalStream();
  resetDocumentVisible();
  vi.unstubAllGlobals();
});

describe('HTTP/1.1 connection budget (VS-227)', () => {
  it('hiding six workspace streams frees a slot so a REST fetch can start', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => {
      if (CappedEventSource.used >= CAP) {
        return Promise.reject(new Error('no HTTP/1.1 slot'));
      }
      CappedEventSource.used += 1;
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })).finally(() => {
        CappedEventSource.used -= 1;
      });
    }));

    const streams = Array.from({ length: CAP }, (_, i) => {
      const s = new EventStream(`ws${i}`, new QueryClient());
      s.start();
      return s;
    });
    expect(CappedEventSource.open.filter((s) => !s.closed)).toHaveLength(CAP);
    expect(CappedEventSource.used).toBe(CAP);

    await expect(request('/api/w/ws1/threads/th_1/messages', { timeoutMs: 0 })).rejects.toBeInstanceOf(NetworkError);

    setDocumentHidden(true);
    expect(CappedEventSource.open.filter((s) => !s.closed)).toHaveLength(0);
    expect(streams[0]!.getStatus().state).toBe('hidden');
    expect(CappedEventSource.used).toBe(0);

    await expect(request('/api/w/ws1/threads/th_1/messages', { timeoutMs: 0 })).resolves.toEqual([]);
    for (const s of streams) s.stop();
  });

  it('global fan-in uses one connection even with more workspaces than the HTTP/1.1 budget (VS-509)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('[]', { status: 200 }))));
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <FanInStreams ids={Array.from({ length: CAP + 4 }, (_, i) => `ws${i}`)} />
      </QueryClientProvider>,
    );
    expect(CappedEventSource.open.filter((s) => !s.closed)).toHaveLength(1);
    expect(CappedEventSource.used).toBe(1);
    await expect(request('/api/w/ws1/threads', { timeoutMs: 0 })).resolves.toEqual([]);
    view.unmount();
  });
});
