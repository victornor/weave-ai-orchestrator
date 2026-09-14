/** V2 Work: the column fold, the kanban/table toggle, the merge strip, the phone list, live status and search. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, Run, Ticket, WorkerActivitySummary, WorkerModelOption } from '@weave-ai/shared';
import { agent, decision, project, ticket } from './factories';

const state = vi.hoisted(() => ({
  active: [] as Ticket[],
  finished: [] as Ticket[],
  workers: [] as Agent[],
  runs: [] as Run[],
  decisions: [] as Decision[],
  workerOptions: undefined as WorkerModelOption[] | undefined,
  stream: null as import('../api/events').EventStream | null,
  search: {} as Record<string, string | undefined>,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  createTicket: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

/** A controllable EventSource: enough of the surface `EventStream` uses to deliver a named frame. */
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

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    o?.select ? o.select({ location: { pathname: '/v2/w/ws1/work' } }) : '/v2/w/ws1/work',
  useParams: () => ({ ws: 'ws1' }),
}));
// Keep the real `useWorkspaceEvents` shape — the live test must go through the real `EventStream`,
// not a captured callback — by subscribing to whatever `state.stream` holds.
vi.mock('../api/context', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useWs: () => 'ws1',
    useHookWs: (o?: string) => o ?? 'ws1',
    useWorkspaceEvents: (fn: (e: unknown) => void) => {
      const stream = state.stream;
      const ref = useRef(fn);
      ref.current = fn;
      useEffect(() => {
        if (!stream) return;
        return stream.onEvent((e) => ref.current(e));
      }, [stream]);
    },
  };
});
vi.mock('../app/link', () => ({
  useGo: () => state.go,
  useSearchParams: () => state.search,
}));
vi.mock('../api/hooks', () => ({
  useTickets: (params: Record<string, unknown> = {}, opts: { enabled?: boolean } = {}) => {
    const enabled = opts.enabled ?? true;
    const terminal = params['status'] === 'done,cancelled';
    const raw = String(params['search'] ?? '').trim().toLowerCase();
    const empty = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    if (raw) {
      if (!enabled) return empty;
      const includeTerminal = params['includeTerminal'] === true;
      const matches = [...state.active, ...state.finished].filter(
        (t) =>
          (includeTerminal || (t.status !== 'done' && t.status !== 'cancelled')) &&
          (t.title.toLowerCase().includes(raw) ||
            (t.description ?? '').toLowerCase().includes(raw) ||
            t.identifier.toLowerCase().includes(raw)),
      );
      return { data: matches, isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: terminal ? (enabled ? state.finished : undefined) : state.active, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useProjects: () => ({ data: [project({ id: 'p1', slug: 'web', name: 'web' })] }),
  useRoles: () => ({ data: [] }),
  useWorkers: () => ({ data: state.workers }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: state.workers })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: state.decisions ?? [] })),
  useRuns: () => ({ data: state.runs }),
  useDecisions: () => ({ data: state.decisions }),
  useWorkspaceSummary: () => ({ data: { config: {} } }),
  useModels: () => ({ data: state.workerOptions === undefined ? undefined : { workerOptions: state.workerOptions } }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 0 }] }),
  useMe: () => ({ data: { operator: { username: 'victor' }, session: { id: 's', kind: 'web' }, totpEnabled: false } }),
  useCreateTicket: () => ({ mutate: state.createTicket, isPending: false }),
}));

const { V2WorkScreen } = await import('../v2/work/Work');
const { EventStream } = await import('../api/events');

const column = (key: string): HTMLElement => {
  const el = document.querySelector(`[data-v2-column="${key}"]`);
  if (!el) throw new Error(`no ${key} column`);
  return el as HTMLElement;
};

const liveWorker = (over: Partial<WorkerActivitySummary> & Partial<Agent> = {}): Agent =>
  Object.assign(agent({ id: 'a1', ticketId: 'tk_1', status: 'running', name: 'Platform Engineer #1' }), over);

beforeEach(() => {
  state.go = vi.fn();
  state.createTicket = vi.fn();
  state.workers = [];
  state.runs = [];
  state.decisions = [];
  state.workerOptions = undefined;
  state.stream = null;
  FakeEventSource.open = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  state.search = {};
  state.active = [
    ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Backlogged', status: 'todo' }),
    ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Needs a decision', status: 'blocked' }),
    ticket({ id: 'tk_3', identifier: 'ACME-3', title: 'Moving', status: 'in_progress' }),
  ];
  state.finished = [ticket({ id: 'tk_4', identifier: 'ACME-4', title: 'Landed', status: 'done', completedAt: new Date().toISOString() })];
  state.decisions = [decision({ id: 'd1', ticketId: 'tk_2', kind: 'question', status: 'open', owner: 'human' })];
});

describe('V2 Work columns', () => {
  it('lands tickets in the folded columns and moves a decision ticket to Proposed', () => {
    render(<V2WorkScreen />);
    expect(within(column('todo')).getByText('Backlogged')).toBeInTheDocument();
    expect(within(column('proposed')).getByText('Needs a decision')).toBeInTheDocument();
    expect(within(column('blocked')).queryByText('Needs a decision')).toBeNull();
    expect(within(column('in_progress')).getByText('Moving')).toBeInTheDocument();
    expect(within(column('done')).getByText('Landed')).toBeInTheDocument();
  });

  it('renders an empty column narrow and a populated one wide', () => {
    render(<V2WorkScreen />);
    // The width is asserted on the rendered element, not only on the empty marker.
    const inReview = column('in_review');
    expect(inReview.getAttribute('data-empty')).toBe('true');
    expect(inReview.style.flex).toBe('0 0 108px');
    expect(inReview.style.minWidth).toBe('108px');
    expect(within(inReview).getByText('0')).toBeInTheDocument();

    const proposed = column('proposed');
    expect(proposed.style.flex).toBe('1 0 236px');
    expect(proposed.style.minWidth).toBe('236px');
  });

  it('widens a column when a card arrives and leaves the still-empty ones narrow', () => {
    const view = render(<V2WorkScreen />);
    expect(column('in_review').style.flex).toBe('0 0 108px');

    state.active = [...state.active, ticket({ id: 'tk_5', identifier: 'ACME-5', title: 'Reviewing', status: 'in_review' })];
    view.rerender(<V2WorkScreen />);

    const inReview = column('in_review');
    expect(inReview.style.flex).toBe('1 0 236px');
    expect(inReview.style.minWidth).toBe('236px');
    expect(within(inReview).getByText('Reviewing')).toBeInTheDocument();
    expect(column('blocked').style.flex).toBe('0 0 108px');
  });

  it('does not tag a card with the status of the column it sits in', () => {
    render(<V2WorkScreen />);
    // A Backlog card must not repeat "Backlog"/"backlog" (the folded-status bug), and an In progress
    // card must not repeat its column either.
    const backlogCard = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(backlogCard).queryByText('Backlog')).toBeNull();
    expect(within(backlogCard).queryByText('backlog')).toBeNull();
    const movingCard = document.querySelector('[data-v2-card="ACME-3"]') as HTMLElement;
    expect(within(movingCard).queryByText(/in progress/i)).toBeNull();
  });

  it('shows the tier tag only when the catalog holds two or more options', () => {
    const first = render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(card).queryByText('default')).toBeNull();
    first.unmount();

    state.workerOptions = [
      { id: 'quick', description: 'Fast.', runtime: 'claude', model: null },
      { id: 'standard', description: 'Default.', runtime: 'claude', model: null },
    ];
    render(<V2WorkScreen />);
    const withCatalog = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(withCatalog).getByText('default')).toBeInTheDocument();
  });

  it('renders the tier, kind and needs-you tags in one casing (VS-400)', () => {
    // The tier goes through the card's `.v2-tag` recipe, not `Badge`, so all three tags carry the
    // same casing instead of `task`/`needs you` beside `DEFAULT`.
    state.workerOptions = [
      { id: 'quick', description: 'Fast.', runtime: 'claude', model: null },
      { id: 'standard', description: 'Default.', runtime: 'claude', model: null },
    ];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-2"]') as HTMLElement;
    const tags = ['change', 'default', 'needs you'].map((label) => within(card).getByText(label));
    for (const tag of tags) {
      const casings = ['uppercase', 'lowercase', 'capitalize'].filter((c) => tag.classList.contains(c));
      expect(casings).toEqual(['uppercase']);
    }
  });

  it('derives the column count from the cards rendered', () => {
    render(<V2WorkScreen />);
    const cards = column('todo').querySelectorAll('[data-v2-card]');
    expect(cards).toHaveLength(1);
    expect(within(column('todo')).getByText('1')).toBeInTheDocument();
  });

  it('shows no status glyph on a card and puts the project tag in its hue', () => {
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).queryByRole('img')).toBeNull();
    const tag = card.querySelector('[data-project-color]') as HTMLElement;
    expect(tag).toBeTruthy();
    expect(tag.getAttribute('style')).toContain('var(--project-');
  });

  it('opens a ticket from its card', () => {
    render(<V2WorkScreen />);
    fireEvent.click(document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement);
    expect(state.go).toHaveBeenCalledWith(
      '/v2/w/$ws/tickets/$ticketId',
      expect.objectContaining({ params: { ws: 'ws1', ticketId: 'ACME-1' } }),
    );
  });

  it('marks a ticket whose spec archive pull request is still pending (VS-389)', () => {
    state.active = [ticket({
      id: 'tk_9', identifier: 'ACME-9', title: 'Spec archive pending', status: 'in_progress',
      delivery: { openspecArchive: { changeName: 'x', state: 'pending', pendingPrUrl: 'https://example.com/pr/313' } },
    })];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-9"]') as HTMLElement;
    expect(within(card).getByText('spec archive pending')).toBeInTheDocument();
  });
});

describe('V2 Work views', () => {
  it('switches between kanban and table over the same tickets', () => {
    render(<V2WorkScreen />);
    expect(document.querySelector('[data-v2-work-kanban]')).toBeTruthy();
    expect(document.querySelector('[data-v2-work-table]')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));

    expect(document.querySelector('[data-v2-work-kanban]')).toBeNull();
    const table = document.querySelector('[data-v2-work-table]') as HTMLElement;
    expect(table).toBeTruthy();
    expect(within(table).getByText('Backlogged')).toBeInTheDocument();
    expect(within(table).getByText('Needs a decision')).toBeInTheDocument();
    // A row carries its status glyph.
    const row = document.querySelector('[data-v2-table-row="ACME-1"]') as HTMLElement;
    expect(row.querySelector('svg[role="img"]')).toBeTruthy();
  });

  it('narrows both views with a project filter', () => {
    render(<V2WorkScreen />);
    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: 'p1' } });
    // The filter keeps the project's tickets; switching still shows the same set.
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(document.querySelector('[data-v2-table-row="ACME-1"]')).toBeTruthy();
  });

  it('renders the phone list with a glyph per row', () => {
    render(<V2WorkScreen />);
    const phone = document.querySelector('[data-v2-work-phone]') as HTMLElement;
    const row = phone.querySelector('[data-v2-phone-row="ACME-3"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector('svg[role="img"]')).toBeTruthy();
  });
});

describe('V2 Work merge strip', () => {
  it('says nothing is landing when nothing merges', () => {
    render(<V2WorkScreen />);
    expect(screen.getByText('nothing landing')).toBeInTheDocument();
  });

  it('counts landing and waiting from the loaded tickets, and names the wait (VS-391)', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z', delivery: { ciState: 'pending', ciStateAt: '2026-09-10T00:00:00.000Z' } }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    expect(screen.getByText(/1 landing · 1 waiting · on CI/)).toBeInTheDocument();
  });

  it('names the next waiting ticket and its priority when it jumped an earlier join (VS-390)', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', priority: 'medium', mergeQueuedAt: '2026-09-10T00:05:00.000Z', mergeStartedAt: null }),
      ticket({ id: 'tk_3', identifier: 'ACME-3', status: 'merging', priority: 'critical', mergeQueuedAt: '2026-09-10T00:06:00.000Z', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    expect(screen.getByText(/1 landing · 2 waiting · on the worker · next: ACME-3 \(critical, jumped ahead\)/)).toBeInTheDocument();
  });

  it('names the next waiting ticket without a reason when it is in join order', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', priority: 'medium', mergeQueuedAt: '2026-09-10T00:05:00.000Z', mergeStartedAt: null }),
      ticket({ id: 'tk_3', identifier: 'ACME-3', status: 'merging', priority: 'medium', mergeQueuedAt: '2026-09-10T00:06:00.000Z', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    expect(screen.getByText(/on the worker · next: ACME-2$/)).toBeInTheDocument();
  });
});

describe('V2 Work new ticket', () => {
  it('creates a ticket through the existing endpoint', () => {
    render(<V2WorkScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A fresh task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(state.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', kind: 'task', title: 'A fresh task' }),
      expect.anything(),
    );
  });
});

describe('V2 Work liveness', () => {
  it('puts a live worker on an in-progress ticket In progress', () => {
    state.workers = [liveWorker()];
    render(<V2WorkScreen />);
    const inProgress = column('in_progress');
    expect(within(inProgress).getByText('Backlogged')).toBeInTheDocument();
    expect(within(inProgress).getByText('Platform Engineer #1')).toBeInTheDocument();
  });

  it('shows the working mark, activity line and test tally on a live card', () => {
    state.workers = [liveWorker({
      activity: { verb: 'testing', label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' },
      tests: { passed: 30, total: 30 },
    })];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(card).getByText('Running tests')).toBeInTheDocument();
    expect(within(card).getByText('30/30 tests')).toBeInTheDocument();
    expect(card.querySelector('[data-v2-activity] svg[role="img"]')).toBeTruthy();
  });

  it('falls back to the worker\'s last run summary between turns', () => {
    state.workers = [liveWorker({ activity: null, tests: null })];
    state.runs = [run({ agentId: 'a1', summary: 'Implemented tasks 1-3', finishedAt: '2026-09-13T11:00:00.000Z' })];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(card).getByText('Implemented tasks 1-3')).toBeInTheDocument();
  });

  it('shows a paused worker\'s reason and no working mark', () => {
    state.workers = [agent({ id: 'a1', ticketId: 'tk_1', status: 'paused', pauseReason: 'quota exhausted' })];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(card).getByText('paused · quota exhausted')).toBeInTheDocument();
    expect(card.querySelector('[data-v2-activity]')).toBeNull();
  });

  it('shows no working mark on an idle ticket', () => {
    render(<V2WorkScreen />);
    expect(document.querySelectorAll('[data-v2-activity]')).toHaveLength(0);
  });

  it('shows the same live line on the table row and the phone list', () => {
    state.workers = [liveWorker({
      activity: { verb: 'testing', label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' },
      tests: { passed: 30, total: 30 },
    })];
    render(<V2WorkScreen />);
    const phoneRow = document.querySelector('[data-v2-phone-row="ACME-1"]') as HTMLElement;
    expect(within(phoneRow).getByText('Running tests')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    const tableRow = document.querySelector('[data-v2-table-row="ACME-1"]') as HTMLElement;
    expect(within(tableRow).getByText('Running tests')).toBeInTheDocument();
    expect(tableRow.querySelector('[data-v2-activity] svg[role="img"]')).toBeTruthy();
  });

  it('updates a card from a named worker.activity SSE frame delivered through the real EventStream', async () => {
    state.stream = new EventStream('ws1', new QueryClient());
    state.workers = [liveWorker({ activity: { verb: 'reading', label: 'Reading code', target: null, since: '2026-09-13T11:59:00.000Z' }, tests: null })];
    render(<V2WorkScreen />);
    expect(screen.queryByText('Running tests')).toBeNull();

    act(() => state.stream!.start());
    const fake = FakeEventSource.open[FakeEventSource.open.length - 1]!;
    expect(fake.listeners.has('worker.activity')).toBe(true);

    await act(async () => {
      fake.listeners.get('worker.activity')![0]!({
        data: JSON.stringify({
          type: 'worker.activity', seq: 0, workspaceId: 'ws1', entityType: 'worker', entityId: 'a1', createdAt: '2026-09-13T12:00:00.000Z',
          payload: { agentId: 'a1', ticketId: 'tk_1', activity: { verb: 'testing', label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' }, tests: { passed: 30, total: 30 } },
        }),
      } as MessageEvent<string>);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(screen.getAllByText('Running tests').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30/30 tests').length).toBeGreaterThan(0);
    state.stream!.stop();
  });
});

function run(over: Partial<Run> = {}): Run {
  return {
    id: 'run_1', workspaceId: 'ws1', agentId: 'a1', ticketId: 'tk_1', sessionId: null, wakeupIds: [],
    runtimeId: 'claude-code', model: null, status: 'succeeded', turnEpoch: 1, cwd: '/w', startedAt: '2026-09-13T10:00:00.000Z',
    finishedAt: '2026-09-13T10:05:00.000Z', exitCode: 0, signal: null, pid: null, pgid: null, errorCode: null,
    errorFamily: null, retryOfRunId: null, usage: null, costCents: null, result: null, liveness: null, logPath: null,
    summary: null, createdAt: '2026-09-13T10:00:00.000Z', ...over,
  };
}

const searchBox = (): HTMLInputElement => screen.getByLabelText('Search tickets') as HTMLInputElement;
const cardText = (identifier: string): string =>
  (document.querySelector(`[data-v2-card="${identifier}"]`) as HTMLElement | null)?.textContent ?? '';

describe('V2 Work search', () => {
  it('filters by title through the daemon search and writes ?q=', async () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Deploy the pipeline', status: 'todo' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Unrelated work', status: 'todo' }),
    ];
    render(<V2WorkScreen />);
    fireEvent.change(searchBox(), { target: { value: 'deploy' } });
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-2"]')).toBeNull());
    expect(cardText('ACME-1')).toContain('Deploy the pipeline');
    expect(screen.getByText('1 ticket matches')).toBeInTheDocument();
    expect(state.go).toHaveBeenCalledWith(
      '/v2/w/$ws/work',
      expect.objectContaining({ params: { ws: 'ws1' }, replace: true, search: expect.objectContaining({ q: 'deploy' }) }),
    );
  });

  it('matches a description the client never loaded', async () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Alpha', description: 'contains ZEBRA', status: 'todo' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Beta', description: 'nothing here', status: 'todo' }),
    ];
    render(<V2WorkScreen />);
    fireEvent.change(searchBox(), { target: { value: 'zebra' } });
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-2"]')).toBeNull());
    expect(cardText('ACME-1')).toContain('Alpha');
  });

  it('matches an identifier and shows finished tickets while searching', async () => {
    state.active = [ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Backlogged', status: 'todo' })];
    // Finished long enough ago that the default recent window hides it; only the search shows it.
    state.finished = [
      ticket({ id: 'tk_9', identifier: 'ACME-9', title: 'Old work', status: 'done', completedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    render(<V2WorkScreen />);
    expect(document.querySelector('[data-v2-card="ACME-9"]')).toBeNull();
    fireEvent.change(searchBox(), { target: { value: 'ACME-9' } });
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-1"]')).toBeNull());
    expect(within(column('done')).getByText('Old work')).toBeInTheDocument();
  });

  it('highlights the matched words in a title', async () => {
    state.active = [ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Deploy the pipeline', status: 'todo' })];
    render(<V2WorkScreen />);
    fireEvent.change(searchBox(), { target: { value: 'deploy' } });
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-1"] mark')).toBeTruthy());
    expect(document.querySelector('[data-v2-card="ACME-1"] mark')?.textContent).toBe('Deploy');
  });

  it('survives a remount from ?q= and combines with ?project=', async () => {
    state.search = { q: 'deploy', project: 'p1' };
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Deploy the pipeline', projectId: 'p1', status: 'todo' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Deploy elsewhere', projectId: 'p2', status: 'todo' }),
    ];
    const first = render(<V2WorkScreen />);
    expect(searchBox()).toHaveValue('deploy');
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-1"]')).toBeTruthy());
    expect(document.querySelector('[data-v2-card="ACME-2"]')).toBeNull();
    first.unmount();

    render(<V2WorkScreen />);
    expect(searchBox()).toHaveValue('deploy');
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-1"]')).toBeTruthy());
    expect(document.querySelector('[data-v2-card="ACME-2"]')).toBeNull();
  });

  it('clears with the button and restores the board', async () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Deploy the pipeline', status: 'todo' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Beta', status: 'todo' }),
    ];
    render(<V2WorkScreen />);
    fireEvent.change(searchBox(), { target: { value: 'deploy' } });
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-2"]')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(searchBox()).toHaveValue('');
    await waitFor(() => expect(document.querySelector('[data-v2-card="ACME-2"]')).toBeTruthy());
  });

  it('focuses the field on /', () => {
    render(<V2WorkScreen />);
    fireEvent.keyDown(window, { key: '/' });
    expect(searchBox()).toHaveFocus();
  });
});
