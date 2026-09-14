/**
 * VS-369: a V2 decision card updates from the workspace event stream while it is on screen. A V2
 * global page has no `WorkspaceProvider`, so `V2Shell` fans in one stream per listed workspace;
 * this drives those streams (a `decision.updated` review mark, a `decision.created`) through the
 * real `EventStream`/`invalidateFor` and asserts the rendered card flips or appears. It also covers
 * the Chat decisions pane, which gets its stream from `V2Workspace`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@weave-ai/shared';
import { decision } from './factories';

const state = vi.hoisted(() => ({
  decisions: {} as Record<string, Decision[]>,
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  const listFor = (workspace: string): Decision[] => (state.decisions[workspace] ?? []).filter((d) => d.status === 'open');
  return {
    ...actual,
    getWorkspaceId: () => '',
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
      ws: (workspace: string, path: string) => {
        if (path.startsWith('/decisions')) return Promise.resolve(listFor(workspace));
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

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: (opts?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    opts?.select ? opts.select({ location: { pathname: '/v2/needs' } }) : '/v2/needs',
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

/** Enough of the EventSource surface `EventStream` uses, with the named listeners reachable. */
class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.open.push(this);
  }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close(): void {
    this.closed = true;
  }
}

const { V2NeedsPage } = await import('../v2/NeedsYouPage');
const { V2ChatPage } = await import('../v2/ChatPage');
const { FanInStreams, WorkspaceProvider } = await import('../api/context');

function deliver(workspace: string, evt: { type: string; entityId: string; payload: unknown }): void {
  const src = FakeEventSource.open.filter((s) => s.url.includes(`/w/${workspace}/events`)).at(-1);
  for (const fn of src?.listeners.get(evt.type) ?? []) {
    fn({ data: JSON.stringify({ seq: 1, createdAt: '2026-09-14T00:00:00.000Z', ...evt }) } as MessageEvent<string>);
  }
}

const held = (over: Partial<Decision> = {}): Decision => decision({ weaverReviewStatus: 'unseen', ...over });
const reviewed = (d: Decision): Decision => ({ ...d, weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-14T00:00:01.000Z', weaverReviewNote: 'fine' });

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  FakeEventSource.open = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  state.decisions = {};
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

function mount(ui: ReactNode): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return qc;
}

describe('live decision updates in V2', () => {
  it('flips a held card to approvable when the review lands (global Needs you)', async () => {
    const card = held({ id: 'd1', workspaceId: 'alpha' });
    state.decisions = { alpha: [card] };
    mount(
      <>
        <V2NeedsPage />
        <FanInStreams ids={['alpha']} />
      </>,
    );

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();

    state.decisions.alpha = [reviewed(card)];
    await act(async () => deliver('alpha', { type: 'decision.updated', entityId: 'd1', payload: state.decisions['alpha']![0] }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it('adds a card on decision.created (global Needs you)', async () => {
    const card = held({ id: 'd1', workspaceId: 'alpha', title: 'First' });
    state.decisions = { alpha: [card] };
    mount(
      <>
        <V2NeedsPage />
        <FanInStreams ids={['alpha']} />
      </>,
    );
    await screen.findByText('First');

    const created = held({ id: 'd2', workspaceId: 'alpha', title: 'Second' });
    state.decisions.alpha = [card, created];
    await act(async () => deliver('alpha', { type: 'decision.created', entityId: 'd2', payload: created }));

    expect(await screen.findByText('Second')).toBeInTheDocument();
  });

  it('flips a held card in the Chat decisions pane', async () => {
    const card = held({ id: 'd1', workspaceId: 'ws1' });
    state.decisions = { ws1: [card] };
    mount(
      <WorkspaceProvider ws="ws1">
        <V2ChatPage />
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();

    state.decisions.ws1 = [reviewed(card)];
    await act(async () => deliver('ws1', { type: 'decision.updated', entityId: 'd1', payload: state.decisions['ws1']![0] }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });
});
