/** V2 Work: the column fold, the kanban/table toggle, the merge strip, the phone list, live status and search. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, PlanOrigin, Project, Run, Ticket, WorkerActivitySummary, WorkerModelOption } from '@weave-ai/shared';
import { agent, decision, project, ticket } from './factories';

const state = vi.hoisted(() => ({
  active: [] as Ticket[],
  finished: [] as Ticket[],
  projects: [] as Project[],
  roles: [] as Array<{ id: string; name: string }>,
  workers: [] as Agent[],
  runs: [] as Run[],
  decisions: [] as Decision[],
  workerOptions: undefined as WorkerModelOption[] | undefined,
  planOrigins: new Map<string, import('@weave-ai/shared').PlanOrigin>(),
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
    o?.select ? o.select({ location: { pathname: '/w/ws1/work' } }) : '/w/ws1/work',
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
  A: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
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
  useProjects: () => ({ data: state.projects }),
  useRoles: () => ({ data: state.roles }),
  useWorkers: () => ({ data: state.workers }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: state.workers })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: state.decisions ?? [] })),
  useRuns: () => ({ data: state.runs }),
  useDecisions: () => ({ data: state.decisions }),
  useWorkspaceSummary: () => ({ data: { config: {} } }),
  useModels: () => ({ data: state.workerOptions === undefined ? undefined : { workerOptions: state.workerOptions } }),
  usePlanOrigins: () => ({ data: state.planOrigins }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 0 }] }),
  useMe: () => ({ data: { operator: { username: 'victor' }, session: { id: 's', kind: 'web' }, totpEnabled: false } }),
  useCreateTicket: () => ({ mutate: state.createTicket, isPending: false }),
}));

const { V2WorkScreen, V2_KANBAN_COLUMN_WIDTH } = await import('../v2/work/Work');
const { EventStream } = await import('../api/events');

const column = (key: string): HTMLElement => {
  const el = document.querySelector(`[data-v2-column="${key}"]`);
  if (!el) throw new Error(`no ${key} column`);
  return el as HTMLElement;
};

/** VS-550: the merge strip line's whole text, whitespace-collapsed (its parts are links, so not one node). */
const mergeLine = (): string => (document.querySelector('[data-v2-merge-strip-line]')?.textContent ?? '').replace(/\s+/g, ' ').trim();

const liveWorker = (over: Partial<WorkerActivitySummary> & Partial<Agent> = {}): Agent =>
  Object.assign(agent({ id: 'a1', ticketId: 'tk_1', status: 'running', name: 'Platform Engineer #1' }), over);

beforeEach(() => {
  state.go = vi.fn();
  state.createTicket = vi.fn();
  state.projects = [project({ id: 'p1', slug: 'web', name: 'web' })];
  state.roles = [];
  state.workers = [];
  state.runs = [];
  state.decisions = [];
  state.workerOptions = undefined;
  state.planOrigins = new Map();
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

  it('gives every column one equal-share growing rule, empty or full (VS-471)', () => {
    render(<V2WorkScreen />);
    const columns = [...document.querySelectorAll('[data-v2-column]')] as HTMLElement[];
    expect(columns).toHaveLength(6);
    // One identical growing rule for every column: `flex: 1 1 0` (grow an equal share, shrink, zero
    // basis) with the shared 236px minimum. A column never grows beyond its share and never shrinks
    // below the minimum, whatever it holds.
    expect(new Set(columns.map((c) => c.style.flex))).toEqual(new Set(['1 1 0px']));
    expect(new Set(columns.map((c) => c.style.minWidth))).toEqual(new Set([`${V2_KANBAN_COLUMN_WIDTH}px`]));
    // The empty marker stays, but an empty column is no narrower than a populated one.
    expect(column('in_review').getAttribute('data-empty')).toBe('true');
  });

  it('keeps every column one equal-share growing rule when only Done has cards (VS-471)', () => {
    state.active = [];
    state.finished = [ticket({ id: 'tk_4', identifier: 'ACME-4', title: 'Landed', status: 'done', completedAt: new Date().toISOString() })];
    render(<V2WorkScreen />);
    expect(within(column('done')).getByText('Landed')).toBeInTheDocument();
    const columns = [...document.querySelectorAll('[data-v2-column]')] as HTMLElement[];
    expect(new Set(columns.map((c) => c.style.flex))).toEqual(new Set(['1 1 0px']));
    expect(new Set(columns.map((c) => c.style.minWidth))).toEqual(new Set([`${V2_KANBAN_COLUMN_WIDTH}px`]));
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
      '/w/$ws/tickets/$ticketId',
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

describe('V2 Work horizontal scroll (VS-411)', () => {
  it('gives the kanban a horizontal scroller whose gesture is not swallowed by a column', () => {
    render(<V2WorkScreen />);
    const kanban = document.querySelector('[data-v2-work-kanban]') as HTMLElement;
    // The columns overflow the pane and the kanban is the thing that scrolls them.
    expect(kanban.className).toContain('overflow-x-auto');
    const list = column('todo').querySelector('.ac-scroll') as HTMLElement;
    // `.ac-scroll` contains overscroll on both axes; the x axis must chain out to the kanban, or a
    // sideways gesture over the cards reaches nothing and the last columns are unreachable.
    expect(list.className).toContain('overscroll-x-auto');
  });

  it('gives the table an overflow container wider than its pane', () => {
    render(<V2WorkScreen />);
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    const table = document.querySelector('[data-v2-work-table]') as HTMLElement;
    expect(table.className).toContain('overflow-auto');
    // The inner table sets a width floor, so a narrow pane scrolls rather than squeezing columns.
    expect((table.firstElementChild as HTMLElement).className).toContain('min-w-[880px]');
  });
});

describe('V2 Work phone scope (VS-404)', () => {
  const scopeRow = (): HTMLElement => {
    const el = document.querySelector('[data-v2-work-scope]');
    if (!el) throw new Error('no phone scope row');
    return el as HTMLElement;
  };

  it('gates the desktop toolbar below md and shows the scope row on phone', () => {
    render(<V2WorkScreen />);
    // The two desktop toolbar rows are hidden by default and only become flex at md and up, the
    // same breakpoint the phone list uses (`md:hidden`). The controls live inside those rows, so
    // hidden rows hide them; the scope row is the mirror image (`md:hidden`).
    const toolbar = document.querySelector('[data-v2-work-toolbar]') as HTMLElement;
    const filters = document.querySelector('[data-v2-work-filters]') as HTMLElement;
    expect(toolbar.className).toContain('hidden');
    expect(toolbar.className).toContain('md:flex');
    expect(filters.className).toContain('hidden');
    expect(filters.className).toContain('md:flex');
    expect(within(toolbar).getByRole('radio', { name: 'Kanban' })).toBeInTheDocument();
    expect(filters.querySelector('[data-v2-work-search]')).toBeTruthy();
    // The phone scope row is visible only below md; the merge strip stays on both.
    expect(scopeRow().className).toContain('md:hidden');
    expect(scopeRow().className).not.toContain('hidden md:flex');
    const strip = document.querySelector('[data-v2-merge-strip]') as HTMLElement;
    expect(strip.className).not.toContain('md:flex');
  });

  it('narrows the phone list to needs-you tickets and restores it with All work', () => {
    render(<V2WorkScreen />);
    expect(document.querySelector('[data-v2-phone-row="ACME-1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-phone-row="ACME-2"]')).toBeTruthy();

    fireEvent.click(within(scopeRow()).getByRole('button', { name: 'Needs you' }));
    // ACME-2 is the one with an open human decision; the other two drop out of the phone list.
    expect(document.querySelector('[data-v2-phone-row="ACME-2"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-phone-row="ACME-1"]')).toBeNull();
    expect(document.querySelector('[data-v2-phone-row="ACME-3"]')).toBeNull();

    fireEvent.click(within(scopeRow()).getByRole('button', { name: 'All work' }));
    expect(document.querySelector('[data-v2-phone-row="ACME-1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-phone-row="ACME-3"]')).toBeTruthy();
  });

  it('narrows the phone list by project chip and clears Needs you', () => {
    state.projects = [project({ id: 'p1', slug: 'web', name: 'web' }), project({ id: 'p2', slug: 'api', name: 'api' })];
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Web work', status: 'todo', projectId: 'p1' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Api work', status: 'todo', projectId: 'p2' }),
    ];
    render(<V2WorkScreen />);
    expect(document.querySelector('[data-v2-phone-row="ACME-1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-phone-row="ACME-2"]')).toBeTruthy();

    fireEvent.click(within(scopeRow()).getByRole('button', { name: 'api' }));
    expect(document.querySelector('[data-v2-phone-row="ACME-1"]')).toBeNull();
    expect(document.querySelector('[data-v2-phone-row="ACME-2"]')).toBeTruthy();

    fireEvent.click(within(scopeRow()).getByRole('button', { name: 'All work' }));
    expect(document.querySelector('[data-v2-phone-row="ACME-1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-phone-row="ACME-2"]')).toBeTruthy();
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
    expect(mergeLine()).toMatch(/^1 landing ACME-1 · on CI .* · 1 waiting ACME-2 · next: ACME-2$/);
  });

  it('links the tickets it counts, so the summary reaches them (VS-550)', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    const links = [...document.querySelectorAll('[data-v2-merge-strip-line] a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/w/$ws/tickets/$ticketId');
    expect(links).toHaveLength(3); // landing + waiting + next (the next ticket is repeated)
    expect(screen.getByRole('link', { name: 'ACME-1' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'ACME-2' })).toHaveLength(2); // waiting + next
  });

  it('names the next waiting ticket and its priority when it jumped an earlier join (VS-390)', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', priority: 'medium', mergeQueuedAt: '2026-09-10T00:05:00.000Z', mergeStartedAt: null }),
      ticket({ id: 'tk_3', identifier: 'ACME-3', status: 'merging', priority: 'critical', mergeQueuedAt: '2026-09-10T00:06:00.000Z', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    expect(mergeLine()).toMatch(/^1 landing ACME-1 · on the worker · 2 waiting ACME-3 ACME-2 · next: ACME-3 \(critical, jumped ahead\)$/);
  });

  it('names the next waiting ticket without a reason when it is in join order', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', priority: 'medium', mergeQueuedAt: '2026-09-10T00:05:00.000Z', mergeStartedAt: null }),
      ticket({ id: 'tk_3', identifier: 'ACME-3', status: 'merging', priority: 'medium', mergeQueuedAt: '2026-09-10T00:06:00.000Z', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    expect(mergeLine()).toMatch(/^1 landing ACME-1 · on the worker · 2 waiting ACME-2 ACME-3 · next: ACME-2$/);
  });
});

describe('V2 Work assignee label (VS-550)', () => {
  it('names the role on a finished ticket instead of unassigned', () => {
    state.finished = [ticket({ id: 'tk_4', identifier: 'ACME-4', title: 'Landed', status: 'done', completedAt: new Date().toISOString(), assigneeRoleId: 'r1' })];
    state.roles = [{ id: 'r1', name: 'Platform Engineer' }];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-4"]') as HTMLElement;
    expect(within(card).getByText('Platform Engineer')).toBeInTheDocument();
    expect(within(card).queryByText('unassigned')).toBeNull();
  });

  it('still reads unassigned when no role is assigned', () => {
    state.finished = [ticket({ id: 'tk_4', identifier: 'ACME-4', title: 'Landed', status: 'done', completedAt: new Date().toISOString(), assigneeRoleId: null })];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-4"]') as HTMLElement;
    expect(within(card).getByText('unassigned')).toBeInTheDocument();
  });

  it('keeps a live worker’s identity rather than its role name', () => {
    state.active = [ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Moving', status: 'in_progress', assigneeRoleId: 'r1' })];
    state.workers = [liveWorker({ ticketId: 'tk_1' })];
    state.roles = [{ id: 'r1', name: 'Platform Engineer' }];
    render(<V2WorkScreen />);
    const card = document.querySelector('[data-v2-card="ACME-1"]') as HTMLElement;
    expect(within(card).getByText('Platform Engineer #1')).toBeInTheDocument();
    expect(within(card).queryByText('Platform Engineer')).toBeNull();
  });
});

describe('V2 Work merge card state (VS-550)', () => {
  it('marks the landing ticket and gives a queued one its position', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Landing', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z', delivery: { ciState: 'pending', ciStateAt: '2026-09-10T00:00:00.000Z' } }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Queued', status: 'merging', mergeStartedAt: null, priority: 'critical', mergeQueuedAt: '2026-09-10T00:05:00.000Z' }),
    ];
    render(<V2WorkScreen />);
    const landing = document.querySelector('[data-v2-card="ACME-1"] [data-v2-merge="landing"]') as HTMLElement;
    expect(landing.textContent).toMatch(/landing · on CI/);
    const waiting = document.querySelector('[data-v2-card="ACME-2"] [data-v2-merge="waiting"]') as HTMLElement;
    expect(waiting.textContent).toMatch(/queued · #1/);
  });
});

describe('V2 Work plan origin (VS-550)', () => {
  it('names the plan and marks an early dispatch on the card', () => {
    state.planOrigins = new Map<string, PlanOrigin>([['tk_1', { ticketId: 'tk_1', planId: 'plan1', planTitle: 'Redesign the board', planStatus: 'drafting', dispatched: true }]]);
    render(<V2WorkScreen />);
    const tag = document.querySelector('[data-v2-card="ACME-1"] [data-v2-plan-origin="dispatched"]') as HTMLElement;
    expect(tag.textContent).toContain('Redesign the board');
    expect(tag.textContent).toContain('dispatched');
    expect(document.querySelector('[data-v2-card="ACME-3"] [data-v2-plan-origin]')).toBeNull();
  });

  it('distinguishes a submission-time ticket from a dispatched one', () => {
    state.planOrigins = new Map<string, PlanOrigin>([['tk_1', { ticketId: 'tk_1', planId: 'plan1', planTitle: 'Redesign', planStatus: 'submitted', dispatched: false }]]);
    render(<V2WorkScreen />);
    expect(document.querySelector('[data-v2-card="ACME-1"] [data-v2-plan-origin="submission"]')?.textContent).toContain('at submission');
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
    summary: null, lastEventAt: null, lastProgressAt: null, lastError: null, createdAt: '2026-09-13T10:00:00.000Z', ...over,
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
      '/w/$ws/work',
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

/** jsdom ships no `Element.animate`, so the motion tests install a spy one; put the original back. */
function installElementAnimate(): { spy: ReturnType<typeof vi.fn>; restore: () => void } {
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  const spy = vi.fn(() => ({ finished: Promise.resolve(), cancel: () => undefined }) as unknown as Animation);
  proto.animate = spy;
  return {
    spy,
    restore: () => {
      if (original === undefined) delete proto.animate;
      else proto.animate = original;
    },
  };
}

describe('V2 Work motion', () => {
  it('moves a card to the new column when its status changes, and keeps it openable', () => {
    const view = render(<V2WorkScreen />);
    expect(within(column('in_progress')).getByText('Moving')).toBeInTheDocument();

    act(() => {
      state.active = state.active.map((t) => (t.id === 'tk_3' ? { ...t, status: 'in_review' as const } : t));
    });
    view.rerender(<V2WorkScreen />);

    expect(within(column('in_review')).getByText('Moving')).toBeInTheDocument();
    expect(within(column('in_progress')).queryByText('Moving')).toBeNull();
    const card = document.querySelector('[data-v2-card="ACME-3"]') as HTMLElement;
    fireEvent.click(card);
    expect(state.go).toHaveBeenCalledWith(
      '/w/$ws/tickets/$ticketId',
      expect.objectContaining({ params: { ws: 'ws1', ticketId: 'ACME-3' } }),
    );
  });

  it('animates a live status move but not a filter switch', () => {
    const { spy, restore } = installElementAnimate();
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      const key = el.closest?.('[data-v2-column]')?.getAttribute('data-v2-column') ?? '';
      const left = ['todo', 'proposed', 'in_progress', 'in_review', 'blocked', 'done'].indexOf(key) * 236;
      return { left, top: 0, width: 236, height: 80, right: left + 236, bottom: 80, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const view = render(<V2WorkScreen />);
    spy.mockClear();

    act(() => {
      state.active = state.active.map((t) => (t.id === 'tk_3' ? { ...t, status: 'in_review' as const } : t));
    });
    view.rerender(<V2WorkScreen />);
    expect(spy).toHaveBeenCalled();

    spy.mockClear();
    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: 'p1' } });
    expect(spy).not.toHaveBeenCalled();

    rect.mockRestore();
    restore();
  });

  it('animates nothing under prefers-reduced-motion', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const { spy, restore } = installElementAnimate();
    const view = render(<V2WorkScreen />);
    spy.mockClear();

    act(() => {
      state.active = state.active.map((t) => (t.id === 'tk_3' ? { ...t, status: 'in_review' as const } : t));
    });
    view.rerender(<V2WorkScreen />);
    expect(spy).not.toHaveBeenCalled();

    restore();
    window.matchMedia = originalMatchMedia;
  });
});
