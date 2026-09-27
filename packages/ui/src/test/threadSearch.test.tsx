/**
 * `useThreadSearch` (VS-320) and `useThreadMessages`'s anchored mode (VS-714) against the real
 * hooks, not the `Chat.tsx`-facing mock in `chat.test.tsx` — that mock bypasses debouncing entirely,
 * so it cannot cover it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as Array<{ ws: string; path: string }> }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (workspace: string, path: string) => {
        state.calls.push({ ws: workspace, path });
        if (path.includes('/search')) {
          return Promise.resolve([{ messageId: 'm1', authorKind: 'human', authorId: 'v1', createdAt: 't0', snippet: 'a \u0002hit\u0003' }]);
        }
        return Promise.resolve([{ id: 'm1', body: 'hi' }]);
      },
    },
  };
});

const { useThreadSearch, useThreadMessages } = await import('../api/hooks');

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrap(qc: QueryClient): ({ children }: { children: ReactNode }) => React.ReactElement {
  return ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { state.calls = []; });

describe('useThreadSearch (VS-320)', () => {
  it('an empty or whitespace-only query never reaches the network', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useThreadSearch('th_1', '   '), { wrapper: wrap(client()) });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.data).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(state.calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces: rapid keystrokes settle to one request for the final value', async () => {
    vi.useFakeTimers();
    try {
      const qc = client();
      const { rerender } = renderHook(({ q }: { q: string }) => useThreadSearch('th_1', q), { wrapper: wrap(qc), initialProps: { q: 'm' } });
      act(() => { vi.advanceTimersByTime(80); });
      rerender({ q: 'mi' });
      act(() => { vi.advanceTimersByTime(80); });
      rerender({ q: 'mid' });
      // Short of the debounce window since the last keystroke: nothing has fired yet.
      await act(async () => { await vi.advanceTimersByTimeAsync(80); });
      expect(state.calls).toHaveLength(0);
      // Past the debounce window with no further typing: the settled value fires, once.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]?.path).toContain('q=mid');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not query a null thread id even with a real query', async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useThreadSearch(null, 'midnight'), { wrapper: wrap(client()) });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(state.calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useThreadMessages anchored mode (VS-714)', () => {
  it('does not fetch a null thread id even with an anchor given', () => {
    renderHook(() => useThreadMessages(null, 'm1'), { wrapper: wrap(client()) });
    expect(state.calls).toHaveLength(0);
  });

  it('seeds the anchored window through the around() read', async () => {
    renderHook(() => useThreadMessages('th_1', 'm1'), { wrapper: wrap(client()) });
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.calls[0]?.path).toBe('/threads/th_1/messages?around=m1');
  });

  it('a null anchor pages the ordinary tailing view instead', async () => {
    renderHook(() => useThreadMessages('th_1', null), { wrapper: wrap(client()) });
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.calls[0]?.path).not.toContain('around=');
  });
});
