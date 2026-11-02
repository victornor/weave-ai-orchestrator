/** VS-955: the retained-copy hooks — the report's path, the scan and the reclaim offer's request bodies. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as Array<{ ws: string; path: string; init?: { method?: string; body?: unknown } }> }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: () => 'ws1' }));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (ws: string, path: string, init?: { method?: string; body?: unknown }) => {
        state.calls.push({ ws, path, init });
        if (path === '/workers/retained') return Promise.resolve({ scannedAt: 't', scanning: false, copies: [], totals: { count: 0, bytes: 0 } });
        if (path === '/workers/retained/reclaim') return Promise.resolve({ cards: [{ decisionId: 'd1', directories: ['w1'], bytes: 1, own: true }], skipped: [] });
        return Promise.resolve({ started: true, scanning: true });
      },
    },
  };
});

const { useOfferReclaim, useRetainedCopies, useRetainedScan } = await import('../api/hooks');

const wrapper = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => { state.calls = []; });

describe('retained-copy hooks (VS-955)', () => {
  it('reads the report from the workspace route', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRetainedCopies(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.scannedAt).toBe('t'));
    expect(state.calls[0]).toMatchObject({ ws: 'ws1', path: '/workers/retained' });
  });

  it('posts a scan and an offer with the selected directories', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const scan = renderHook(() => useRetainedScan(), { wrapper: wrapper(qc) });
    await act(async () => { await scan.result.current.mutateAsync(); });
    const offer = renderHook(() => useOfferReclaim(), { wrapper: wrapper(qc) });
    let out: unknown;
    await act(async () => { out = await offer.result.current.mutateAsync(['w1', 'w2']); });
    expect(state.calls).toEqual([
      { ws: 'ws1', path: '/workers/retained/scan', init: { method: 'POST', body: {} } },
      { ws: 'ws1', path: '/workers/retained/reclaim', init: { method: 'POST', body: { directories: ['w1', 'w2'] } } },
    ]);
    expect(out).toMatchObject({ cards: [{ decisionId: 'd1' }] });
  });
});
