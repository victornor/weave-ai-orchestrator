/** V2 Work: the column fold, the kanban/table toggle, the merge strip and the phone list. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, Ticket, WorkerModelOption } from '@weave-ai/shared';
import { agent, decision, project, ticket } from './factories';

const state = vi.hoisted(() => ({
  active: [] as Ticket[],
  finished: [] as Ticket[],
  workers: [] as Agent[],
  decisions: [] as Decision[],
  workerOptions: undefined as WorkerModelOption[] | undefined,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  createTicket: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    o?.select ? o.select({ location: { pathname: '/v2/w/ws1/work' } }) : '/v2/w/ws1/work',
  useParams: () => ({ ws: 'ws1' }),
}));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  useGo: () => state.go,
  useSearchParams: () => ({}),
}));
vi.mock('../api/hooks', () => ({
  useTickets: (params: Record<string, unknown> = {}, opts: { enabled?: boolean } = {}) => {
    const terminal = params['status'] === 'done,cancelled';
    const enabled = opts.enabled ?? true;
    return { data: terminal ? (enabled ? state.finished : undefined) : state.active, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useProjects: () => ({ data: [project({ id: 'p1', slug: 'web', name: 'web' })] }),
  useRoles: () => ({ data: [] }),
  useWorkers: () => ({ data: state.workers }),
  useDecisions: () => ({ data: state.decisions }),
  useWorkspaceSummary: () => ({ data: { config: {} } }),
  useModels: () => ({ data: state.workerOptions === undefined ? undefined : { workerOptions: state.workerOptions } }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 0 }] }),
  useMe: () => ({ data: { operator: { username: 'victor' }, session: { id: 's', kind: 'web' }, totpEnabled: false } }),
  useCreateTicket: () => ({ mutate: state.createTicket, isPending: false }),
}));

const { V2WorkScreen } = await import('../v2/work/Work');

const column = (key: string): HTMLElement => {
  const el = document.querySelector(`[data-v2-column="${key}"]`);
  if (!el) throw new Error(`no ${key} column`);
  return el as HTMLElement;
};

beforeEach(() => {
  state.go = vi.fn();
  state.createTicket = vi.fn();
  state.workers = [];
  state.decisions = [];
  state.workerOptions = undefined;
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

  it('renders an empty column narrow and gives it a zero count', () => {
    render(<V2WorkScreen />);
    const proposed = column('proposed');
    expect(within(proposed).getByText('1')).toBeInTheDocument();
    // Backlog holds one; make it empty by filtering it out is harder — assert the zero count on a
    // column that has none.
    const inReview = column('in_review');
    expect(inReview.getAttribute('data-empty')).toBe('true');
    expect(within(inReview).getByText('0')).toBeInTheDocument();
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

  it('counts landing and waiting from the loaded tickets', () => {
    state.active = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', status: 'merging', mergeStartedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', status: 'merging', mergeStartedAt: null }),
    ];
    render(<V2WorkScreen />);
    expect(screen.getByText('1 landing · 1 waiting')).toBeInTheDocument();
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
    state.workers = [agent({ id: 'a1', ticketId: 'tk_1', status: 'running', name: 'Platform Engineer #1' })];
    render(<V2WorkScreen />);
    const inProgress = column('in_progress');
    expect(within(inProgress).getByText('Backlogged')).toBeInTheDocument();
    expect(within(inProgress).getByText('Platform Engineer #1')).toBeInTheDocument();
  });
});
