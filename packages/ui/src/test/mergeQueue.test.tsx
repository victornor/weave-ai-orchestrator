import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MergeQueue, MergeQueueEntry, MergeQueueOutcome } from '../api/types';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  projects: [] as Array<{ id: string; slug: string }>,
  queue: null as MergeQueue | null,
  asked: [] as Array<string | null | undefined>,
  isLoading: false,
  isError: false,
  go: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => state.go, useSearchParams: () => state.search }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: state.projects }),
  useWorkers: () => ({ data: [{ id: 'ag_1', name: 'Platform Engineer #53' }] }),
  useMergeQueue: (projectId: string | null | undefined) => {
    state.asked.push(projectId);
    return { data: state.queue, isLoading: state.isLoading, isError: state.isError, refetch: vi.fn() };
  },
}));

const { MergeQueueRoute } = await import('../routes/MergeQueue');

const NOW = new Date('2026-09-10T12:00:00.000Z');
const minutesAgo = (n: number): string => new Date(NOW.getTime() - n * 60_000).toISOString();

const entry = (over: Partial<MergeQueueEntry> = {}): MergeQueueEntry => ({
  ticketId: 'tk_1', identifier: 'VS-53', title: 'Full test suite exits cleanly', projectId: 'p1',
  position: null, queuedAt: minutesAgo(9), startedAt: minutesAgo(4), workerId: 'ag_1', ...over,
});

const outcome = (over: Partial<MergeQueueOutcome> = {}): MergeQueueOutcome => ({
  ticketId: 'tk_9', identifier: 'VS-52', title: 'Settings separates the scopes',
  outcome: 'landed', at: minutesAgo(120), mergeCommit: 'abc1234', ...over,
});

const queue = (over: Partial<MergeQueue> = {}): MergeQueue => ({
  projectId: 'p1', concurrency: 1,
  active: [entry()],
  waiting: [
    entry({ ticketId: 'tk_2', identifier: 'VS-56', title: 'Knowledge graph keeps its selection', position: 1, startedAt: null, queuedAt: minutesAgo(8) }),
    entry({ ticketId: 'tk_3', identifier: 'VS-57', title: 'Usage page groups by model', position: 2, startedAt: null, queuedAt: minutesAgo(3) }),
  ],
  recent: [outcome()],
  ...over,
});

/** The section a label heads, so a row can be looked for in the right one. */
const section = (label: string): HTMLElement => {
  const found = screen.getByText(label).closest('section');
  if (!found) throw new Error(`no section for ${label}`);
  return found;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  state.search = {};
  state.projects = [{ id: 'p1', slug: 'web' }];
  state.queue = queue();
  state.asked = [];
  state.isLoading = false;
  state.isError = false;
  state.go = vi.fn();
});

describe('MergeQueueRoute', () => {
  it('shows what is merging, for how long, and how many slots are in use', () => {
    render(<MergeQueueRoute />);
    const landing = section('Landing now');
    expect(within(landing).getByText('VS-53')).toBeInTheDocument();
    expect(within(landing).getByText('Full test suite exits cleanly')).toBeInTheDocument();
    // Four minutes since it was admitted, to the second.
    expect(within(landing).getByText('4m00s')).toBeInTheDocument();
    expect(within(landing).getByText('1 of 1 slots')).toBeInTheDocument();
    expect(within(landing).getByText('Platform Engineer #53')).toBeInTheDocument();
  });

  it('keeps the elapsed time of a merge moving', () => {
    render(<MergeQueueRoute />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(within(section('Landing now')).getByText('4m02s')).toBeInTheDocument();
  });

  it('opens the transcript of the worker doing the merge', () => {
    render(<MergeQueueRoute />);
    fireEvent.click(within(section('Landing now')).getByRole('button', { name: /Open the landing log/ }));
    expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'ws1', workerId: 'ag_1' } });
  });

  it('lists what is waiting in queue order with positions and ages', () => {
    render(<MergeQueueRoute />);
    const waiting = section('Waiting');
    const rows = within(waiting).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('#1');
    expect(rows[0]).toHaveTextContent('VS-56');
    expect(rows[0]).toHaveTextContent('waited 8m');
    expect(rows[1]).toHaveTextContent('#2');
    expect(rows[1]).toHaveTextContent('VS-57');
  });

  it('names every outcome that recently left the queue', () => {
    state.queue = queue({
      recent: [
        outcome(),
        outcome({ ticketId: 'tk_8', identifier: 'VS-49', title: 'Stuck-worker retry card', outcome: 'failed', mergeCommit: null }),
        outcome({ ticketId: 'tk_7', identifier: 'VS-44', title: 'Sent back for changes', outcome: 'withdrawn', mergeCommit: null }),
      ],
    });
    render(<MergeQueueRoute />);
    const recent = section('Recently left the queue');
    expect(within(recent).getByText('landed')).toBeInTheDocument();
    expect(within(recent).getByText('failed')).toBeInTheDocument();
    expect(within(recent).getByText('left the queue')).toBeInTheDocument();
    expect(within(recent).getByText('VS-49')).toBeInTheDocument();
  });

  it('says the queue is empty in words and still shows what recently landed', () => {
    state.queue = queue({ active: [], waiting: [] });
    render(<MergeQueueRoute />);
    expect(screen.getByText('Nothing is merging or waiting to merge.')).toBeInTheDocument();
    expect(screen.queryByText('Landing now')).toBeNull();
    expect(within(section('Recently left the queue')).getByText('VS-52')).toBeInTheDocument();
  });

  it('says so when nothing has ever left the queue', () => {
    state.queue = queue({ active: [], waiting: [], recent: [] });
    render(<MergeQueueRoute />);
    expect(screen.getByText('Nothing has left this queue yet.')).toBeInTheDocument();
  });

  it('opens the ticket a row stands for', () => {
    render(<MergeQueueRoute />);
    fireEvent.click(within(section('Waiting')).getAllByRole('button')[0]!);
    expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'VS-56' } });

    fireEvent.click(within(section('Recently left the queue')).getAllByRole('button')[0]!);
    expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'VS-52' } });
  });

  it('reads the project from the URL', () => {
    state.projects = [{ id: 'p1', slug: 'web' }, { id: 'p2', slug: 'api' }];
    state.search = { project: 'p2' };
    render(<MergeQueueRoute />);
    expect(state.asked.at(-1)).toBe('p2');
  });

  it('falls back to the first project for a project the workspace does not have', () => {
    state.projects = [{ id: 'p1', slug: 'web' }, { id: 'p2', slug: 'api' }];
    state.search = { project: 'gone' };
    render(<MergeQueueRoute />);
    expect(state.asked.at(-1)).toBe('p1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switches project and writes the choice into the URL', () => {
    state.projects = [{ id: 'p1', slug: 'web' }, { id: 'p2', slug: 'api' }];
    render(<MergeQueueRoute />);
    fireEvent.click(screen.getByRole('radio', { name: 'api' }));

    expect(state.asked.at(-1)).toBe('p2');
    expect(state.go).toHaveBeenCalledWith('/w/$ws/merge-queue', expect.objectContaining({ search: expect.objectContaining({ project: 'p2' }) }));
  });

  it('offers no switcher for a workspace with one project', () => {
    render(<MergeQueueRoute />);
    expect(screen.queryByRole('radiogroup', { name: 'Project' })).toBeNull();
  });

  it('shows a typed error with a retry when the queue cannot be read', () => {
    state.queue = null;
    state.isError = true;
    render(<MergeQueueRoute />);
    expect(screen.getByText('MERGE_QUEUE_QUERY_FAILED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says a workspace with no project has nothing to land', () => {
    state.projects = [];
    render(<MergeQueueRoute />);
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
  });
});
