/**
 * VS-369: a V2 decision card leaves the screen the moment its answer is recorded — on the global
 * Needs you page (no workspace context), and through the chat pane's path (the context workspace, no
 * explicit `ws`) — without waiting for the decisions list to refetch. A double click posts once, a
 * closed decision (`wrong_status`) leaves with no error, and a held decision stays with its refusal.
 *
 * The pages run with the real `useAnswerDecision`/`useDecisions`/`useDecisionsMany`; only the HTTP
 * client and the workspace context are faked, so the mutation's cache handling is what is exercised.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@weave-ai/shared';
import { decision } from './factories';

type AnswerOutcome = 'ok' | 'wrong_status' | 'revision_pending';

const state = vi.hoisted(() => ({
  ctxWs: '',
  path: '/needs',
  decisions: {} as Record<string, Decision[]>,
  posts: [] as Array<{ ws: string; path: string }>,
  outcome: 'ok' as AnswerOutcome,
  /** When true the next decisions GET is held open, so a test can prove the card left optimistically. */
  holdDecisions: false,
  heldResolvers: [] as Array<() => void>,
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  const listFor = (workspace: string): Decision[] => (state.decisions[workspace] ?? []).filter((d) => d.status === 'open');
  const close = (id: string): void => {
    for (const list of Object.values(state.decisions)) {
      const d = list.find((x) => x.id === id);
      if (d) d.status = 'answered';
    }
  };
  return {
    ...actual,
    getWorkspaceId: () => state.ctxWs,
    setWorkspaceId: () => undefined,
    api: {
      qs: actual.qs,
      root: (path: string) => {
        if (path === '/workspaces') {
          return Promise.resolve(
            Object.keys(state.decisions).map((id) => ({ id, name: id, ticketPrefix: id.toUpperCase(), root: '', projects: [], needsYou: listFor(id).length })),
          );
        }
        if (path === '/runtimes') return Promise.resolve([]);
        if (path.endsWith('/models')) return Promise.resolve({ models: [] });
        if (path.startsWith('/incidents')) return Promise.resolve({ items: [], total: 0 });
        return Promise.resolve({});
      },
      ws: (workspace: string, path: string, init?: { method?: string; body?: unknown }) => {
        if (init?.method === 'POST' && path.includes('/answer')) {
          state.posts.push({ ws: workspace, path });
          const id = path.split('/')[2]!;
          if (state.outcome === 'revision_pending') {
            return Promise.reject(new actual.ApiError(409, { code: 'revision_pending', message: 'decision is held', details: { weaverReviewStatus: 'concerns', weaverReviewNote: 'fix it first' } }));
          }
          close(id);
          if (state.outcome === 'wrong_status') {
            return Promise.reject(new actual.ApiError(409, { code: 'wrong_status', message: `decision ${id} is answered`, details: { status: 'answered' } }));
          }
          return Promise.resolve({});
        }
        if (path.startsWith('/decisions')) {
          if (state.holdDecisions) return new Promise((resolve) => { state.heldResolvers.push(() => resolve(listFor(workspace))); });
          return Promise.resolve(listFor(workspace));
        }
        if (path.startsWith('/threads')) {
          if (path.includes('/messages')) return Promise.resolve([]);
          return Promise.resolve([{ id: 't1', label: null, channel: 'web', createdAt: '', updatedAt: '', lastMessageAt: null, messageCount: 0 }]);
        }
        if (path.startsWith('/weaver')) return Promise.resolve({ agent: { id: 'weaver1', runtimeId: 'claude', name: 'Weaver', status: 'active' } });
        if (path.startsWith('/usage')) return Promise.resolve([]);
        if (path.startsWith('/workers') || path.startsWith('/projects') || path.startsWith('/tickets')) return Promise.resolve([]);
        return Promise.resolve({});
      },
    },
  };
});

vi.mock('../api/context', () => ({
  useWs: () => state.ctxWs,
  useHookWs: (o?: string) => o ?? state.ctxWs,
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
  useWorkspaceEvents: () => undefined,
  useOptionalWorkspace: () => null,
  WorkspaceProvider: ({ children }: { children?: ReactNode }) => children,
  FanInStreams: () => null,
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: (opts?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    opts?.select ? opts.select({ location: { pathname: state.path } }) : state.path,
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => <a href={to} {...rest}>{children}</a>,
  useGo: () => () => undefined,
  useSearchParams: () => ({}),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));
vi.mock('../v2/chatSplit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../v2/chatSplit')>();
  return { ...actual, useElementWidth: () => ({ ref: () => undefined, width: 900 }) };
});

const { V2NeedsPage } = await import('../v2/NeedsYouPage');
const { V2ChatPage } = await import('../v2/ChatPage');
const { useAnswerDecision } = await import('../api/hooks');
const { qk } = await import('../api/keys');

const question = (over: Partial<Decision> = {}): Decision =>
  decision({
    id: 'd1',
    workspaceId: 'alpha',
    kind: 'question',
    owner: 'human',
    title: 'Approve now',
    options: [{ key: 'a', label: 'Option A' }],
    inputs: [],
    ...over,
  });

function mount(ui: ReactNode): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return qc;
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  state.ctxWs = '';
  state.path = '/needs';
  state.decisions = {};
  state.posts = [];
  state.outcome = 'ok';
  state.holdDecisions = false;
  state.heldResolvers = [];
  localStorage.clear();
  sessionStorage.clear();
});

describe('answering a V2 decision card', () => {
  it('removes the card on global Needs you without waiting for a refetch', async () => {
    state.decisions = { alpha: [question()] };
    mount(<V2NeedsPage />);
    await screen.findByText('Approve now');

    state.holdDecisions = true;
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]!.ws).toBe('alpha');

    await waitFor(() => expect(screen.queryByText('Approve now')).toBeNull());
    // The list refetch after the answer never resolved, so only the optimistic removal could do this.
    expect(state.heldResolvers.length).toBeGreaterThan(0);
  });

  it('removes the card through the chat pane path (context workspace, no explicit ws)', async () => {
    state.ctxWs = 'ws1';
    state.path = '/w/ws1/chat';
    state.decisions = { ws1: [question({ workspaceId: 'ws1' })] };
    mount(<V2ChatPage />);
    await screen.findByText('Approve now');

    state.holdDecisions = true;
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]!.ws).toBe('ws1');
    await waitFor(() => expect(screen.queryByText('Approve now')).toBeNull());
  });

  it('posts once when send is clicked twice', async () => {
    state.decisions = { alpha: [question()] };
    mount(<V2NeedsPage />);
    await screen.findByText('Approve now');
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    const send = screen.getByRole('button', { name: 'Send answer' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(state.posts).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 25));
    expect(state.posts).toHaveLength(1);
  });

  it('posts once when the answer is submitted twice before the first settles', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useAnswerDecision(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      result.current.mutate({ id: 'd1', ws: 'alpha', key: 'a' });
      result.current.mutate({ id: 'd1', ws: 'alpha', key: 'a' });
    });
    expect(state.posts).toHaveLength(1);
  });

  it('removes an already-answered card with no error', async () => {
    state.outcome = 'wrong_status';
    state.decisions = { alpha: [question()] };
    mount(<V2NeedsPage />);
    await screen.findByText('Approve now');
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(screen.queryByText('Approve now')).toBeNull());
    expect(screen.queryByText(/Already answered/i)).toBeNull();
  });

  it('keeps a held card and shows the refusal', async () => {
    state.outcome = 'revision_pending';
    state.decisions = { alpha: [question()] };
    mount(<V2NeedsPage />);
    await screen.findByText('Approve now');
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText(/Approval is held/i)).toBeInTheDocument();
    expect(screen.getByText('Approve now')).toBeInTheDocument();
  });

  it('leaves a list that keeps answered decisions alone (V1 chat timeline)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const key = [...qk.decisions('v1ws'), { status: ['open', 'answered'], owner: 'human', limit: 200 }];
    const card = question({ id: 'd1', workspaceId: 'v1ws' });
    qc.setQueryData(key, [card]);
    const { result } = renderHook(() => useAnswerDecision(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      result.current.mutate({ id: 'd1', ws: 'v1ws', key: 'a' });
    });
    expect(qc.getQueryData(key)).toEqual([card]);
  });
});
