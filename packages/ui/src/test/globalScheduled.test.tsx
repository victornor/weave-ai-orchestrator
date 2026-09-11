/** VS-231: daemon-wide Scheduled page — fan-out list, fire history, mixed-turn label. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineFire, RoutineListItem, RoutineUsage } from '@agent-conductor/shared';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  workspacesError: false,
  routines: {} as Record<string, RoutineListItem[] | undefined>,
  errors: {} as Record<string, boolean>,
  usage: {} as Record<string, RoutineUsage>,
  fires: {} as Record<string, RoutineFire[]>,
  search: {} as Record<string, string | undefined>,
  patches: [] as Array<{ ws: string; id: string; patch: Record<string, unknown> }>,
}));

function usageZeros(over: Partial<RoutineUsage> = {}): RoutineUsage {
  return { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d', ...over };
}

function routine(over: Partial<RoutineListItem> = {}): RoutineListItem {
  return {
    id: 'rt_1',
    workspaceId: 'alpha',
    name: 'Morning review',
    trigger: { kind: 'schedule', timezone: 'UTC', daily: { hour: 7, minute: 0 } },
    template: { instruction: 'Look at incidents', action: 'report', maxTicketsPerFire: 0, projectId: null },
    roleId: null,
    concurrency: 'skip_if_active',
    status: 'active',
    lastFiredAt: null,
    nextFireAt: '2026-09-12T07:00:00.000Z',
    inFlightWakeId: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    fireCount: 0,
    ...over,
  };
}

vi.mock('../api/context', () => ({
  useWs: () => { throw new Error('useWs must not be called from the Scheduled page'); },
  useHookWs: (o?: string) => { if (!o) throw new Error('useWs must not be called from the Scheduled page'); return o; },
}));
vi.mock('../app/link', () => ({
  useGo: () => vi.fn(),
  useSearchParams: () => state.search,
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspacesError ? undefined : state.workspaces, isError: state.workspacesError, error: null, refetch: vi.fn() }),
  useRoutinesMany: (ids: string[]) => ids.map((id) => ({
    data: state.routines[id],
    isError: Boolean(state.errors[id]),
    refetch: vi.fn(),
  })),
  useRoutineUsageFor: (_ws: string, id: string) => ({ data: state.usage[id] ?? usageZeros(), isLoading: false }),
  useRoutineFires: (_ws: string, id: string, enabled: boolean) => ({
    data: enabled ? (state.fires[id] ?? []) : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateRoutineAt: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchRoutineAt: () => ({
    mutate: (p: { ws: string; id: string; patch: Record<string, unknown> }) => { state.patches.push(p); },
    isPending: false,
  }),
  useRemoveRoutineAt: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { GlobalScheduledRoute } = await import('../routes/GlobalScheduled');

beforeEach(() => {
  state.workspaces = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ];
  state.workspacesError = false;
  state.routines = { alpha: [], beta: [] };
  state.errors = {};
  state.usage = {};
  state.fires = {};
  state.search = {};
  state.patches = [];
});

describe('GlobalScheduledRoute', () => {
  it('shows routines from two workspaces and names them', () => {
    state.routines = {
      alpha: [routine({ id: 'rt_a', name: 'Morning review', fireCount: 2 })],
      beta: [routine({ id: 'rt_b', workspaceId: 'beta', name: 'Nightly digest' })],
    };
    render(<GlobalScheduledRoute />);
    expect(screen.getByText('Morning review')).toBeInTheDocument();
    expect(screen.getByText('Nightly digest')).toBeInTheDocument();
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });

  it('shows schedule, next run, created-at, fire count and 7d spend including zero', () => {
    state.routines = { alpha: [routine({ fireCount: 2 })], beta: [] };
    state.usage = { rt_1: usageZeros() };
    render(<GlobalScheduledRoute />);
    expect(screen.getByText('daily 07:00 UTC')).toBeInTheDocument();
    expect(screen.getByText(/next 2026-09-12 07:00Z/)).toBeInTheDocument();
    expect(screen.getByText(/created 2026-09-11 00:00Z/)).toBeInTheDocument();
    expect(screen.getByText('2 fires')).toBeInTheDocument();
    expect(screen.getByText('7d $0.00')).toBeInTheDocument();
  });

  it('labels a mixed-turn fire and leaves a solo fire unlabelled', () => {
    state.routines = { alpha: [routine({ fireCount: 2 })], beta: [] };
    state.fires = {
      rt_1: [
        {
          wakeId: 'w-mix',
          runId: 'run-mix',
          firedAt: '2026-09-11T08:00:00.000Z',
          status: 'succeeded',
          summary: 'Answered captain and the review.',
          sharedTurn: true,
        },
        {
          wakeId: 'w-solo',
          runId: 'run-solo',
          firedAt: '2026-09-11T07:00:00.000Z',
          status: 'succeeded',
          summary: 'Only this alarm.',
          sharedTurn: false,
        },
      ],
    };
    render(<GlobalScheduledRoute />);
    fireEvent.click(screen.getByText('Morning review'));
    expect(screen.getByText('Answered captain and the review.')).toBeInTheDocument();
    expect(screen.getByText('this run also handled other work')).toBeInTheDocument();
    expect(screen.getByText('Only this alarm.')).toBeInTheDocument();
    expect(screen.getAllByText('this run also handled other work')).toHaveLength(1);
  });

  it('does not show a workspace picker when there is only one workspace', () => {
    state.workspaces = [{ id: 'alpha', name: 'Alpha' }];
    state.routines = { alpha: [] };
    render(<GlobalScheduledRoute />);
    expect(screen.queryByRole('combobox', { name: /Workspace/i })).not.toBeInTheDocument();
    expect(screen.getByText('No scheduled tasks yet.')).toBeInTheDocument();
  });

  it('keeps the other workspace when one fails', () => {
    state.routines = { alpha: [routine()], beta: undefined };
    state.errors = { beta: true };
    render(<GlobalScheduledRoute />);
    expect(screen.getByText('Morning review')).toBeInTheDocument();
    expect(screen.getByText(/Could not load scheduled tasks in Beta/)).toBeInTheDocument();
  });

  it('shows loading while a workspace has not arrived', () => {
    state.routines = { alpha: undefined, beta: undefined };
    render(<GlobalScheduledRoute />);
    expect(screen.queryByText('No scheduled tasks yet.')).not.toBeInTheDocument();
  });

  it('shows empty when nobody has scheduled anything', () => {
    render(<GlobalScheduledRoute />);
    expect(screen.getByText('No scheduled tasks yet.')).toBeInTheDocument();
  });

  it('pauses from the expanded row', () => {
    state.routines = { alpha: [routine()], beta: [] };
    render(<GlobalScheduledRoute />);
    fireEvent.click(screen.getByText('Morning review'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(state.patches).toEqual([{ ws: 'alpha', id: 'rt_1', patch: { status: 'paused' } }]);
  });
});
