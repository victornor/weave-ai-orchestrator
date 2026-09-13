/**
 * VS-350: `useRunPagesMany` fans out one runs page per workspace and keeps the server's own total,
 * so the V2 Runs screen can offer a real load-more across workspaces.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (workspace: string, path: string) => {
        state.calls.push(`${workspace}${path}`);
        const totals: Record<string, number> = { alpha: 120, beta: 3 };
        return Promise.resolve({ items: [{ id: `run_${workspace}` }], total: totals[workspace] });
      },
    },
  };
});

const { useRunPagesMany } = await import('../api/hooks');

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.calls = [];
});

describe('useRunPagesMany', () => {
  it('returns each workspace page with its own total and the requested limit', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRunPagesMany(['alpha', 'beta'], { limit: 50 }), { wrapper: wrap(qc) });

    await waitFor(() => expect(result.current.every((q) => q.data)).toBe(true));

    expect(result.current[0]?.data).toEqual({ runs: [{ id: 'run_alpha' }], total: 120 });
    expect(result.current[1]?.data).toEqual({ runs: [{ id: 'run_beta' }], total: 3 });
    expect(state.calls).toEqual(expect.arrayContaining(['alpha/runs?limit=50', 'beta/runs?limit=50']));
  });
});
