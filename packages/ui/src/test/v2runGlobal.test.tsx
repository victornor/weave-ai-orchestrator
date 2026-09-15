/**
 * VS-386: the global `/runs/$runId` route has no `WorkspaceProvider`. Before the fix `RunBody`
 * called `useRun`, whose `useWs()` threw `useWorkspace outside WorkspaceProvider`, and the screen
 * showed only an error boundary. This mounts the real `RunBody` with the real hooks and the real
 * workspace context (there is none), mocking only the HTTP client — so a hook that still reaches
 * for the provider throws here rather than passing silently behind a hook mock.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@weave-ai/shared';
import { run as makeRun } from './factories';

const state = vi.hoisted(() => ({
  workspaces: [
    { id: 'beta', name: 'Beta' },
    { id: 'alpha', name: 'Alpha' },
  ],
  run: null as Run | null,
  rootCalls: [] as string[],
  wsCalls: [] as Array<{ ws: string; path: string }>,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ runId: 'run_1' }),
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    o?.select ? o.select({ location: { pathname: '/runs/run_1' } }) : '/runs/run_1',
}));
vi.mock('../app/link', () => ({
  useGo: () => vi.fn(),
  useSearchParams: () => ({}),
  A: ({ children }: { children?: unknown }) => <a href="#">{children as never}</a>,
}));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getWorkspaceId: () => null,
    setWorkspaceId: () => undefined,
    api: {
      qs: actual.qs,
      root: (path: string) => {
        state.rootCalls.push(path);
        if (path === '/workspaces') return Promise.resolve(state.workspaces);
        if (path === '/runs/run_1') return Promise.resolve(state.run);
        if (path === '/incidents') return Promise.resolve({ items: [], total: 0 });
        if (path.startsWith('/runtimes/')) return Promise.resolve([]);
        return Promise.resolve({});
      },
      ws: (ws: string, path: string) => {
        state.wsCalls.push({ ws, path });
        if (path.startsWith('/workers')) return Promise.resolve([]);
        if (path.startsWith('/decisions')) return Promise.resolve([]);
        if (path.startsWith('/runs/')) return Promise.resolve([]);
        return Promise.resolve({});
      },
    },
  };
});

const { RunBody } = await import('../v2/RunPage');

beforeEach(() => {
  state.run = makeRun({
    id: 'run_1',
    workspaceId: 'alpha',
    agentId: 'a1',
    status: 'succeeded',
    startedAt: '2026-09-01T09:00:00.000Z',
    finishedAt: '2026-09-01T09:00:51.000Z',
  });
  state.rootCalls.length = 0;
  state.wsCalls.length = 0;
});

function mount(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RunBody runId="run_1" />
    </QueryClientProvider>,
  );
}

describe('the global V2 run detail (VS-386)', () => {
  it('renders a run in a non-first workspace with no WorkspaceProvider', async () => {
    expect(() => mount()).not.toThrow();
    expect(await screen.findByText('succeeded')).toBeInTheDocument();
    const meta = document.querySelector('[data-v2-run-meta]') as HTMLElement;
    expect(meta.textContent).toContain('Started directly');
  });

  it('resolves the run through the global route and scopes later reads to the run own workspace', async () => {
    mount();
    await screen.findByText('succeeded');
    await waitFor(() => expect(state.wsCalls.length).toBeGreaterThan(0));
    expect(state.rootCalls).toContain('/runs/run_1');
    expect(state.wsCalls.every((c) => c.ws === 'alpha')).toBe(true);
  });
});
