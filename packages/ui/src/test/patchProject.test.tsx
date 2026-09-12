/**
 * `usePatchProject` (VS-303): a project PATCH replaces `policies` wholesale, so the hook advances the
 * cached project optimistically. Without it, two changes made before a refetch lands would both be
 * computed from the same stale row and the second would drop the first. These render the real hooks
 * against a mocked `api` so the optimistic write and the rollback are exercised, not stubbed.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  projects: [] as Array<Record<string, unknown>>,
  patches: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  patchDelay: 0,
  patchError: false,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  const applyPatch = (id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> => {
    state.patches.push({ id, patch });
    state.projects = state.projects.map((p) => (p['id'] === id ? { ...p, ...patch } : p));
    const result = state.projects.find((p) => p['id'] === id) ?? {};
    if (state.patchDelay > 0) {
      return new Promise((resolve, reject) => setTimeout(() => (state.patchError ? reject(new Error('nope')) : resolve(result)), state.patchDelay));
    }
    if (state.patchError) return Promise.reject(new Error('nope'));
    return Promise.resolve(result);
  };
  return {
    ...actual,
    api: {
      ws: (_ws: string, path: string, opts?: { method?: string; body?: unknown }) => {
        if (opts?.method === 'PATCH') return applyPatch(path.split('/').pop() ?? '', (opts.body ?? {}) as Record<string, unknown>);
        return Promise.resolve(state.projects);
      },
    },
  };
});

const { useProjects, usePatchProject } = await import('../api/hooks');

function Harness(): React.ReactElement {
  const { data } = useProjects();
  const patch = usePatchProject();
  const policies = (data?.[0]?.['policies'] ?? {}) as Record<string, unknown>;
  return (
    <div>
      <div data-testid="policies">{JSON.stringify(policies)}</div>
      <button onClick={() => patch.mutate({ id: 'p1', patch: { policies: { ...policies, requireCi: false } } })}>set requireCi</button>
      <button onClick={() => patch.mutate({ id: 'p1', patch: { policies: { ...policies, deliveryMode: 'local-branch' } } })}>set deliveryMode</button>
    </div>
  );
}

function renderHarness(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.projects = [{ id: 'p1', slug: 'api', policies: {} }];
  state.patches = [];
  state.patchDelay = 0;
  state.patchError = false;
});

describe('usePatchProject optimistic cache (VS-303)', () => {
  it('shows the change before the request resolves', async () => {
    state.patchDelay = 50;
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('{}'));

    fireEvent.click(screen.getByRole('button', { name: 'set requireCi' }));
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('"requireCi":false'));
  });

  it('rolls the cached row back when the request is rejected', async () => {
    state.patchDelay = 20;
    state.patchError = true;
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('{}'));

    fireEvent.click(screen.getByRole('button', { name: 'set requireCi' }));
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('"requireCi":false'));
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('{}'));
  });

  it('lets a second change carry the first', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('{}'));

    fireEvent.click(screen.getByRole('button', { name: 'set requireCi' }));
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('"requireCi":false'));

    fireEvent.click(screen.getByRole('button', { name: 'set deliveryMode' }));
    await waitFor(() => expect(state.patches).toHaveLength(2));
    expect(state.patches[1]!.patch['policies']).toEqual({ requireCi: false, deliveryMode: 'local-branch' });
  });
});
