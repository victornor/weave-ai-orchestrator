/**
 * `useProjectSync` / `useProjectFetch` (VS-131): the read-only check backing the project overview's
 * sync badge, and the mutation behind its Sync button. Real TanStack Query caching is exercised
 * (not mocked) since the "no re-check within 60s" requirement is exactly what `staleTime` is for.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));

const state = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; init?: unknown }>,
  syncResponse: () => Promise.resolve<{ syncState: string; behindBy: number | null }>({ syncState: 'in_sync', behindBy: null }),
  fetchResponse: () => Promise.resolve({ head: 'abc123', fastForwarded: true }),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (_workspace: string, path: string, init?: unknown) => {
        state.calls.push({ path, init });
        return path.endsWith('/sync') ? state.syncResponse() : state.fetchResponse();
      },
    },
  };
});

const { useProjectSync, useProjectFetch } = await import('../api/hooks');

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  state.calls = [];
  state.syncResponse = () => Promise.resolve({ syncState: 'in_sync', behindBy: null });
  state.fetchResponse = () => Promise.resolve({ head: 'abc123', fastForwarded: true });
});

describe('useProjectSync', () => {
  it('fetches the sync state for the given project', async () => {
    state.syncResponse = () => Promise.resolve({ syncState: 'behind', behindBy: 3 });
    const qc = client();
    const { result } = renderHook(() => useProjectSync('p1'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.data).toEqual({ syncState: 'behind', behindBy: 3 }));
    expect(state.calls).toEqual([{ path: '/projects/p1/sync', init: undefined }]);
  });

  it('does not re-check on a re-render within the 60s staleTime window', async () => {
    const qc = client();
    const { result, rerender } = renderHook(() => useProjectSync('p1'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.calls).toHaveLength(1);

    // An unrelated state change elsewhere on the page re-renders the same hook instance.
    rerender();
    rerender();
    expect(state.calls).toHaveLength(1);
  });
});

describe('useProjectFetch', () => {
  it('posts to the fetch route and invalidates the project sync and list keys', async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProjectFetch('p1'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.calls).toEqual([{ path: '/projects/p1/fetch', init: { method: 'POST' } }]);
    const invalidatedKeys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(invalidatedKeys).toContain(JSON.stringify(['w', 'ws1', 'projects', 'p1', 'sync']));
    expect(invalidatedKeys).toContain(JSON.stringify(['w', 'ws1', 'projects']));
  });
});
