/**
 * `useWorkspaceProjects` (VS-128): one cached query per workspace id, fed from a set of ids the
 * caller controls — the sidebar passes the active workspace plus whatever it has expanded. Real
 * TanStack Query caching is exercised here (not mocked) since the "no refetch on re-expansion"
 * requirement is exactly what the cache is relied on for.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { project } from './factories';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  responses: {} as Record<string, () => Promise<unknown>>,
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (workspace: string) => {
        state.calls.push(workspace);
        return state.responses[workspace]?.() ?? Promise.resolve([]);
      },
    },
  };
});

const { useWorkspaceProjects } = await import('../api/hooks');

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  state.calls = [];
  state.responses = {};
});

describe('useWorkspaceProjects', () => {
  it('fetches each id independently and reports success per workspace', async () => {
    state.responses = {
      alpha: () => Promise.resolve([project({ id: 'p1', slug: 'web' })]),
      beta: () => Promise.resolve([project({ id: 'p2', slug: 'api' })]),
    };
    const qc = client();
    const { result } = renderHook(() => useWorkspaceProjects(['alpha', 'beta']), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.alpha?.status).toBe('success'));
    await waitFor(() => expect(result.current.beta?.status).toBe('success'));
    expect(result.current.alpha?.projects.map((p) => p.slug)).toEqual(['web']);
    expect(result.current.beta?.projects.map((p) => p.slug)).toEqual(['api']);
  });

  it('scopes a failed fetch to its own workspace', async () => {
    state.responses = {
      alpha: () => Promise.resolve([]),
      beta: () => Promise.reject(new Error('boom')),
    };
    const qc = client();
    const { result } = renderHook(() => useWorkspaceProjects(['alpha', 'beta']), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.beta?.status).toBe('error'));
    expect(result.current.alpha?.status).toBe('success');
  });

  it('reports pending while the fetch is outstanding, not empty', async () => {
    let resolve!: (v: unknown[]) => void;
    state.responses = { alpha: () => new Promise((r) => { resolve = r; }) };
    const qc = client();
    const { result } = renderHook(() => useWorkspaceProjects(['alpha']), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    expect(result.current.alpha?.status).toBe('pending');
    expect(result.current.alpha?.projects).toEqual([]);
    resolve([project({ id: 'p1', slug: 'web' })]);
    await waitFor(() => expect(result.current.alpha?.status).toBe('success'));
  });

  it("keeps a dropped id's cached result and does not refetch it once it returns", async () => {
    state.responses = {
      alpha: () => Promise.resolve([]),
      beta: () => Promise.resolve([project({ id: 'p2', slug: 'api' })]),
    };
    const qc = client();
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useWorkspaceProjects(ids), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
      initialProps: { ids: ['alpha', 'beta'] },
    });
    await waitFor(() => expect(result.current.beta?.status).toBe('success'));
    expect(state.calls.filter((c) => c === 'beta')).toHaveLength(1);

    // The group collapses: `beta` drops out of the ids the sidebar asks for.
    rerender({ ids: ['alpha'] });
    expect(result.current.beta).toBeUndefined();

    // Re-expanding asks for it again, but the cached result answers instantly with no new request.
    rerender({ ids: ['alpha', 'beta'] });
    expect(result.current.beta?.status).toBe('success');
    expect(result.current.beta?.projects.map((p) => p.slug)).toEqual(['api']);
    expect(state.calls.filter((c) => c === 'beta')).toHaveLength(1);
  });

  it('never requests an id that was never passed in', async () => {
    state.responses = { alpha: () => Promise.resolve([]) };
    const qc = client();
    renderHook(() => useWorkspaceProjects(['alpha']), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(state.calls).toContain('alpha'));
    expect(state.calls).not.toContain('gamma');
  });
});
