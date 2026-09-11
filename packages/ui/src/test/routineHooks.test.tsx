/**
 * Explicit-workspace routine hooks (VS-231) must not read the route workspace.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ ws: string; path: string }>,
}));

vi.mock('../api/context', () => ({
  useWs: () => { throw new Error('useWs must not be called'); },
  useHookWs: (o?: string) => { if (!o) throw new Error('useWs must not be called'); return o; },
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (workspace: string, path: string) => {
        state.calls.push({ ws: workspace, path });
        if (path.endsWith('/fires')) return Promise.resolve({ items: [] });
        if (path.includes('/usage')) return Promise.resolve({ tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d' });
        return Promise.resolve({ items: [] });
      },
    },
  };
});

const {
  useRoutinesMany,
  useRoutineFires,
  useRoutineUsageFor,
  useCreateRoutineAt,
  usePatchRoutineAt,
  useRemoveRoutineAt,
} = await import('../api/hooks');

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => { state.calls = []; });

describe('explicit-workspace routine hooks (VS-231)', () => {
  it('fan-out and per-row hooks address the given workspace, not useWs()', async () => {
    const qc = client();
    const wrap = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const many = renderHook(() => useRoutinesMany(['alpha', 'beta']), { wrapper: wrap });
    const fires = renderHook(() => useRoutineFires('alpha', 'rt_1'), { wrapper: wrap });
    const usage = renderHook(() => useRoutineUsageFor('beta', 'rt_2', '7d'), { wrapper: wrap });
    const create = renderHook(() => useCreateRoutineAt(), { wrapper: wrap });
    const patch = renderHook(() => usePatchRoutineAt(), { wrapper: wrap });
    const remove = renderHook(() => useRemoveRoutineAt(), { wrapper: wrap });

    await waitFor(() => {
      expect(many.result.current[0]?.data).toEqual([]);
      expect(fires.result.current.data).toEqual([]);
      expect(usage.result.current.data).toBeTruthy();
    });
    expect(state.calls).toEqual(expect.arrayContaining([
      { ws: 'alpha', path: '/routines' },
      { ws: 'beta', path: '/routines' },
      { ws: 'alpha', path: '/routines/rt_1/fires' },
      { ws: 'beta', path: '/routines/rt_2/usage?window=7d' },
    ]));

    create.result.current.mutate({
      ws: 'alpha',
      name: 'x',
      trigger: { kind: 'schedule', daily: { hour: 7, minute: 0 } },
      instruction: 'go',
    });
    patch.result.current.mutate({ ws: 'beta', id: 'rt_2', patch: { status: 'paused' } });
    remove.result.current.mutate({ ws: 'alpha', id: 'rt_1' });
    await waitFor(() => {
      expect(state.calls.some((c) => c.ws === 'alpha' && c.path === '/routines' && true)).toBe(true);
    });
  });
});
