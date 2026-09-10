import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Ticket } from '@agent-conductor/shared';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  active: [] as Ticket[],
  finished: [] as Ticket[],
  workers: [] as Agent[],
  queries: [] as Array<{ params: Record<string, unknown>; enabled: boolean }>,
  decisions: [] as Array<Record<string, unknown>>,
  config: {} as Record<string, unknown>,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@tanstack/react-router', () => ({ useSearch: () => state.search }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => state.go }));
vi.mock('../api/hooks', () => ({
  useTickets: (params: Record<string, unknown> = {}, opts: { enabled?: boolean } = {}) => {
    const enabled = opts.enabled ?? true;
    state.queries.push({ params, enabled });
    const terminal = params['status'] === 'done,cancelled';
    return { data: enabled ? (terminal ? state.finished : state.active) : undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useProjects: () => ({ data: [] }),
  useRoles: () => ({ data: [] }),
  useWorkers: () => ({ data: state.workers }),
  useDecisions: () => ({ data: state.decisions }),
  useWorkspaceSummary: () => ({ data: { config: state.config } }),
}));

const { BoardRoute } = await import('../routes/Board');

const NOW = new Date('2026-09-10T12:00:00.000Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const doneColumn = (): HTMLElement => {
  const heading = screen.getByRole('heading', { name: 'Done' });
  const section = heading.closest('section');
  if (!section) throw new Error('Done column has no section');
  return section;
};

beforeEach(() => {
  vi.setSystemTime(NOW);
  state.search = {};
  state.queries = [];
  state.decisions = [];
  state.config = {};
  state.workers = [];
  state.go = vi.fn();
  state.active = [ticket({ id: 'tk_1', identifier: 'VS-1', title: 'Still going', status: 'in_progress' })];
  state.finished = [
    ticket({ id: 'tk_2', identifier: 'VS-2', title: 'Landed today', status: 'done', completedAt: daysAgo(0) }),
    ticket({ id: 'tk_3', identifier: 'VS-3', title: 'Dropped yesterday', status: 'cancelled', completedAt: null, cancelledAt: daysAgo(1) }),
    ticket({ id: 'tk_4', identifier: 'VS-4', title: 'Landed last month', status: 'done', completedAt: daysAgo(31) }),
  ];
});

describe('BoardRoute paused-worker reason (VS-137)', () => {
  it('shows a paused worker\'s reason on its ticket card, though it is not a live worker', () => {
    state.workers = [agent({ id: 'a1', ticketId: 'tk_1', status: 'paused', pauseReason: 'runtime_login_expired: the claude login expired' })];
    render(<BoardRoute />);
    // The board renders both the phone row and the desktop kanban card at once; either counts.
    const matches = screen.getAllByText((_, el) => el?.textContent === 'paused · runtime_login_expired: the claude login expired');
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('BoardRoute finished tickets', () => {
  it('shows a Done column of recently finished tickets by default, newest first', () => {
    render(<BoardRoute />);
    const done = doneColumn();
    expect(within(done).getByText('Landed today')).toBeTruthy();
    expect(within(done).getByText('Dropped yesterday')).toBeTruthy();
    // Older than the recent window: only "show all" brings it back.
    expect(within(done).queryByText('Landed last month')).toBeNull();
    expect(within(done).getByText('2')).toBeTruthy();

    const titles = within(done).getAllByRole('button').map((b) => b.textContent ?? '');
    expect(titles.findIndex((t) => t.includes('Landed today'))).toBeLessThan(titles.findIndex((t) => t.includes('Dropped yesterday')));
    // A cancelled ticket is chipped apart from a done one.
    const landed = within(done).getByRole('button', { name: /Landed today/ });
    expect(within(landed).getByText('done')).toBeTruthy();
    expect(within(landed).queryByText('cancelled')).toBeNull();
    expect(within(within(done).getByRole('button', { name: /Dropped yesterday/ })).getAllByText('cancelled').length).toBeGreaterThan(0);
  });

  it('asks the daemon for finished tickets ordered by when they finished', () => {
    render(<BoardRoute />);
    const terminal = state.queries.find((q) => q.params['status'] === 'done,cancelled');
    expect(terminal?.params).toMatchObject({ status: 'done,cancelled', sort: 'finished' });
    expect(terminal?.enabled).toBe(true);
    // The active query is untouched by the Done column, so 300 active tickets still fit.
    expect(state.queries.find((q) => !q.params['status'])?.params).toEqual({ limit: 300 });
  });

  it('expands to every finished ticket from the column, and puts the choice in the URL', () => {
    render(<BoardRoute />);
    fireEvent.click(within(doneColumn()).getByRole('button', { name: 'show all' }));

    expect(within(doneColumn()).getByText('Landed last month')).toBeTruthy();
    expect(state.go).toHaveBeenCalledWith('/w/$ws/board', expect.objectContaining({ search: expect.objectContaining({ done: '1' }) }));
    // Once expanded there is nothing left to expand to.
    expect(within(doneColumn()).queryByRole('button', { name: 'show all' })).toBeNull();
  });

  it('honours ?done=1 from the URL as the full finished history', () => {
    state.search = { done: '1' };
    render(<BoardRoute />);
    expect(within(doneColumn()).getByText('Landed last month')).toBeTruthy();
  });

  it('drops the Done column and the finished query when finished tickets are hidden', () => {
    render(<BoardRoute />);
    state.queries = [];
    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }));

    expect(screen.queryByRole('heading', { name: 'Done' })).toBeNull();
    expect(screen.queryByText('Landed today')).toBeNull();
    expect(state.queries.find((q) => q.params['status'] === 'done,cancelled')?.enabled).toBe(false);
    expect(state.go).toHaveBeenCalledWith('/w/$ws/board', expect.objectContaining({ search: expect.objectContaining({ done: '0' }) }));
  });

  it('shows the Outcome column in the table whenever a finished ticket is on the board', () => {
    render(<BoardRoute />);
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(screen.getByRole('columnheader', { name: 'Outcome' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }));
    expect(screen.queryByRole('columnheader', { name: 'Outcome' })).toBeNull();
  });
});

describe('BoardRoute merge queue', () => {
  it('points at the merge queue instead of rendering it among the columns', () => {
    state.active = [
      ticket({ id: 'tk_5', identifier: 'VS-5', title: 'Landing', status: 'merging', mergeQueuedAt: daysAgo(0), mergeStartedAt: daysAgo(0) }),
      ticket({ id: 'tk_6', identifier: 'VS-6', title: 'Behind it', status: 'merging', mergeQueuedAt: daysAgo(0) }),
    ];
    render(<BoardRoute />);

    expect(screen.getByText('1 landing \u00b7 1 waiting')).toBeTruthy();
    // The line belongs to the filter bar, not to the scrolling body the columns live in.
    expect(screen.getByText('Merge queue').closest('section')).toBeNull();
  });

  it('keeps the line when nothing is landing, so the board does not change shape', () => {
    render(<BoardRoute />);
    expect(screen.getByText('nothing landing')).toBeTruthy();
  });

  it('opens the merge queue view, carrying the project the board is filtered to', () => {
    state.search = { project: 'p1' };
    render(<BoardRoute />);
    fireEvent.click(screen.getByText('Merge queue'));
    expect(state.go).toHaveBeenCalledWith('/w/$ws/merge-queue', { params: { ws: 'ws1' }, search: { project: 'p1' } });
  });
});
