/**
 * VS-630: the rail's counts stay live on a workspace page.
 *
 * The rail counts every workspace, but a workspace page used to hold only that workspace's event
 * stream — the shell mounted the daemon-wide one only on global pages — so a worker starting in
 * another workspace never invalidated the rail's counts, and only opening Live (a global page)
 * corrected them. These tests drive the real `V2Shell` (real `FanInStreams`/`EventStream`/
 * `invalidateFor` over a fake `EventSource`) and the real `LiveBody` against one `QueryClient`, and
 * assert the rail badge and the floor's cards agree.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision } from '@weave-ai/shared';
import { agent, decision } from './factories';
import { LIVE_RUN_GRACE_MS, liveCounts } from '../lib/liveOrder';
import { qk } from '../api/keys';
import { resetGlobalStream } from '../api/streams';

const state = vi.hoisted(() => ({
  path: '/w/alpha/needs',
  search: {} as Record<string, string | undefined>,
  go: vi.fn(),
  workspaces: [] as Array<{ id: string; internalId: string; name: string; ticketPrefix: string; root: string; projects: string[]; needsYou: number }>,
  workers: {} as Record<string, Agent[]>,
  decisions: {} as Record<string, Decision[]>,
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  const workersFor = (ws: string): Agent[] => state.workers[ws] ?? [];
  const decisionsFor = (ws: string): Decision[] => state.decisions[ws] ?? [];
  return {
    ...actual,
    getWorkspaceId: () => null,
    setWorkspaceId: () => undefined,
    api: {
      qs: actual.qs,
      root: (path: string) => {
        if (path === '/workspaces') return Promise.resolve(state.workspaces);
        if (path.startsWith('/incidents')) return Promise.resolve({ items: [], total: 0 });
        return Promise.resolve({});
      },
      ws: (ws: string, path: string) => {
        if (path.startsWith('/workers')) return Promise.resolve(workersFor(ws));
        if (path.startsWith('/decisions')) return Promise.resolve(decisionsFor(ws));
        return Promise.resolve([]);
      },
    },
  };
});

vi.mock('../api/hooks', async () => {
  const actual = await vi.importActual<typeof import('../api/hooks')>('../api/hooks');
  const empty = (ids: readonly string[]): Array<{ data: unknown }> => ids.map(() => ({ data: [] }));
  return {
    ...actual,
    // The shell and the floor read the same real worker/decision queries (below); everything else is
    // a static stub, so the test is about the live invalidation path, not about those screens.
    useMe: () => ({ data: undefined }),
    useDaemonUpdate: () => ({ data: undefined }),
    useDaemonUpgrade: () => ({ data: undefined }),
    useWorkspaceProjects: () => ({}),
    useWorkspacePlugins: () => ({}),
    useRolesMany: empty,
    useTicketsMany: empty,
    useModelsMany: (ids: readonly string[]) => ids.map(() => ({ data: { workerOptions: [] } })),
    useRuntimes: () => ({ data: [] }),
    useRuntimeModels: () => ({ data: [] }),
    useRuns: () => ({ data: [] }),
    usePartialOutput: () => 'none',
  };
});

vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    (o?.select ? o.select({ location: { pathname: state.path } }) : state.path),
  useParams: () => ({}),
}));

vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => <a href={to} {...rest}>{children}</a>,
  useGo: () => state.go,
  useSearchParams: () => state.search,
}));

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

const { V2Shell } = await import('../v2/V2Shell');
const { LiveBody } = await import('../v2/LivePage');

/** Mirrors `v2decisionLive.test.tsx`: deliver an event on the daemon-wide (`/api/events`) stream. */
function deliver(workspace: string, evt: { type: string; entityId: string; entityType?: string; payload: unknown; seq?: number }): void {
  const src = FakeEventSource.open.filter((s) => s.url === '/api/events' || s.url.includes(`/w/${workspace}/events`)).at(-1);
  for (const fn of src?.listeners.get(evt.type) ?? []) {
    fn({ data: JSON.stringify({ seq: evt.seq ?? 1, workspaceId: workspace, entityType: 'agent', createdAt: '2026-09-20T00:00:00.000Z', ...evt }) } as MessageEvent<string>);
  }
}

function mount(ui: ReactNode): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return qc;
}

/** The workspace list resolves before the worker fan-out starts, so wait on that key to prove the
 *  initial fetch has landed before changing the fixture and delivering an event. */
async function settled(qc: QueryClient, key: readonly unknown[]): Promise<void> {
  await waitFor(() => expect(qc.getQueryData(key)).toBeDefined());
}

/** The rail row with this href, whatever its scope. */
const railRow = (href: string): HTMLElement | null => document.querySelector(`a[href="${href}"]`);
/** The count a rail row shows (0 when it renders none). */
function railCount(href: string): number {
  const span = railRow(href)?.querySelector('span[aria-label$="waiting"]');
  return span ? Number(span.textContent) : 0;
}
const workingCards = (): number => document.querySelectorAll('[data-v2-live-status="working"]').length;

const ws = (id: string, name: string, needsYou = 0): (typeof state)['workspaces'][number] => ({
  id, internalId: id, name, ticketPrefix: id.toUpperCase(), root: '', projects: [], needsYou,
});

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  FakeEventSource.open = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  state.path = '/w/alpha/needs';
  state.search = {};
  state.go = vi.fn();
  state.workspaces = [ws('alpha', 'Alpha'), ws('beta', 'Beta')];
  state.workers = { alpha: [], beta: [] };
  state.decisions = { alpha: [], beta: [] };
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  resetGlobalStream();
  vi.clearAllMocks();
});

describe('the rail stays live on a workspace page (VS-630)', () => {
  it('moves the Live badge from the daemon-wide stream with no Live page and no navigation', async () => {
    const qc = mount(<V2Shell theme="dark" onTheme={() => undefined} />);
    await settled(qc, [...qk.workers('alpha'), {}]);
    expect(railCount('/live')).toBe(0);
    // The Live page is not mounted, so nothing on the page can refetch the badge.
    expect(document.querySelector('[data-v2-live-grid]')).toBeNull();

    const started = agent({ id: 'a1', name: 'Backend Engineer #1', ticketId: 'tk1', status: 'running', createdAt: '2026-09-20T00:00:00.000Z' });
    state.workers.alpha = [started];
    await act(async () => deliver('alpha', { type: 'worker.spawned', entityId: 'a1', payload: started }));
    await waitFor(() => expect(railCount('/live')).toBe(1));

    // A worker that leaves the roster (retired) drops out; the between-turns grace is covered below.
    const gone = { ...started, status: 'retired' as const };
    state.workers.alpha = [];
    await act(async () => deliver('alpha', { type: 'worker.retired', entityId: 'a1', payload: gone }));
    await waitFor(() => expect(railCount('/live')).toBe(0));
    expect(state.go).not.toHaveBeenCalled();
  });

  it("raises the Everywhere Live badge from another workspace's worker, leaving this workspace's rows alone", async () => {
    const qc = mount(<V2Shell theme="dark" onTheme={() => undefined} />);
    await settled(qc, [...qk.workers('alpha'), {}]);
    await settled(qc, [...qk.workers('beta'), {}]);

    const started = agent({ id: 'b1', name: 'Web Engineer #1', workspaceId: 'beta', ticketId: 'tk9', status: 'running', createdAt: '2026-09-20T00:00:00.000Z' });
    state.workers.beta = [started];
    await act(async () => deliver('beta', { type: 'worker.spawned', entityId: 'b1', payload: started }));

    await waitFor(() => expect(railCount('/live')).toBe(1));
    // The current workspace's own rows did not move.
    expect(railCount('/w/alpha/needs')).toBe(0);
    expect(railCount('/w/beta/needs')).toBe(0);
  });

  it("raises the Everywhere Needs-you badge from another workspace's decision", async () => {
    const qc = mount(<V2Shell theme="dark" onTheme={() => undefined} />);
    await settled(qc, [...qk.decisions('beta'), { status: 'open', owner: 'human' }]);
    expect(railCount('/needs')).toBe(0);

    const asked = decision({ id: 'd1', workspaceId: 'beta', kind: 'question', title: 'Which branch should land first?' });
    state.decisions.beta = [asked];
    await act(async () => deliver('beta', { type: 'decision.created', entityId: 'd1', entityType: 'decision', payload: asked }));

    await waitFor(() => expect(railCount('/needs')).toBe(1));
  });
});

describe('the rail reconciles a global page from the live-only worker summary (VS-667)', () => {
  const liveFrame = (agentId: string): Record<string, unknown> => ({
    agentId,
    ticketId: null,
    activity: { verb: 'thinking', label: 'Thinking', target: null, since: '2026-09-20T00:00:00.000Z' },
    live: { state: 'working', label: 'Working', since: '2026-09-20T00:00:00.000Z', toolCount: 0, turnMs: 0, sinceLastMs: 0, wholeStepsOnly: false },
    tests: null,
  });

  it('moves the Live badge from a seq-0 worker.activity summary with no workspace stream mounted', async () => {
    // A global page: no WorkspaceProvider, so the rail's per-workspace reads would only hear durable
    // frames. `/live` is the Everywhere scope and mounts the daemon-wide stream.
    state.path = '/live';
    const qc = mount(<V2Shell theme="dark" onTheme={() => undefined} />);
    await settled(qc, [...qk.workers('alpha'), {}]);
    expect(railCount('/live')).toBe(0);
    // The read the rail holds still says a1 is merely active.
    const idle = agent({ id: 'a1', status: 'active', createdAt: '2026-09-20T00:00:00.000Z' });
    qc.setQueryData([...qk.workers('alpha'), {}], [idle]);
    expect(railCount('/live')).toBe(0);

    // a1 starts a turn: the server's read now says running, and a live-only summary frame arrives.
    state.workers.alpha = [{ ...idle, status: 'running' as const }];
    await act(async () => deliver('alpha', { type: 'worker.activity', entityId: 'a1', entityType: 'agent', payload: liveFrame('a1'), seq: 0 }));
    await waitFor(() => expect(railCount('/live')).toBe(1));
    expect(state.go).not.toHaveBeenCalled();
  });

  it('does not add a worker for an idle summary frame', async () => {
    state.path = '/live';
    const qc = mount(<V2Shell theme="dark" onTheme={() => undefined} />);
    await settled(qc, [...qk.workers('alpha'), {}]);
    expect(railCount('/live')).toBe(0);
    const idleFrame = { agentId: 'ghost', ticketId: null, activity: null, live: null, tests: null };
    await act(async () => deliver('alpha', { type: 'worker.activity', entityId: 'ghost', entityType: 'agent', payload: idleFrame, seq: 0 }));
    expect(railCount('/live')).toBe(0);
  });
});

describe('the rail badge and the Live floor are one derivation (VS-630)', () => {
  it('agree across two workspaces and through the handover grace', async () => {
    const a1 = agent({ id: 'a1', name: 'A1', ticketId: 'tk1', status: 'running', createdAt: '2026-09-20T00:00:00.000Z' });
    const h1 = agent({ id: 'h1', name: 'H1', ticketId: 'tk2', status: 'running', createdAt: '2026-09-20T00:01:00.000Z' });
    const b1 = agent({ id: 'b1', name: 'B1', workspaceId: 'beta', ticketId: 'tk3', status: 'running', createdAt: '2026-09-20T00:02:00.000Z' });
    state.workers = { alpha: [a1, h1], beta: [b1] };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (): React.ReactElement => (
      <QueryClientProvider client={qc}>
        <V2Shell theme="dark" onTheme={() => undefined} />
        <LiveBody />
      </QueryClientProvider>
    );
    const view = render(tree());
    await waitFor(() => expect(workingCards()).toBe(3));
    expect(railCount('/live')).toBe(3);

    // h1's turn ends. It is no longer "running", but the grace holds it in the working group, and
    // both surfaces must keep counting it — the contract is that they cannot disagree.
    vi.useFakeTimers();
    const h1Idle = { ...h1, status: 'active' as const };
    qc.setQueryData([...qk.workers('alpha'), {}], [a1, h1Idle]);
    await act(async () => {
      view.rerender(tree());
    });
    expect(railCount('/live')).toBe(3);
    expect(workingCards()).toBe(3);

    await act(async () => {
      vi.advanceTimersByTime(LIVE_RUN_GRACE_MS);
    });
    expect(railCount('/live')).toBe(2);
    expect(workingCards()).toBe(2);
  });
});

describe('liveCounts', () => {
  it('counts each list and the total in one pass', () => {
    const working = new Set(['a', 'b']);
    expect(liveCounts([[{ id: 'a' }, { id: 'x' }], [{ id: 'b' }]], working)).toEqual({ total: 2, perList: [1, 1] });
    expect(liveCounts([], working)).toEqual({ total: 0, perList: [] });
  });
});