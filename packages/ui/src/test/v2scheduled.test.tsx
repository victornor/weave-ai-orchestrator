/** V2 Scheduled (VS-348): the design's list with scope in the project's hue, plus CRUD. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineFire, RoutineListItem, RoutineUsage } from '@weave-ai/shared';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  routines: {} as Record<string, RoutineListItem[] | undefined>,
  fires: {} as Record<string, RoutineFire[]>,
  projects: {} as Record<string, Array<{ id: string; slug: string; name?: string | null }>>,
  patches: [] as Array<{ ws: string; id: string; patch: Record<string, unknown> }>,
  removes: [] as Array<{ ws: string; id: string }>,
  creates: [] as Array<Record<string, unknown>>,
}));

function usageZeros(): RoutineUsage {
  return { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d' };
}

function routine(over: Partial<RoutineListItem> = {}): RoutineListItem {
  return {
    id: 'rt_1', workspaceId: 'alpha', name: 'Morning review',
    trigger: { kind: 'schedule', timezone: 'UTC', daily: { hour: 7, minute: 0 } },
    template: { instruction: 'Look at incidents', action: 'report', maxTicketsPerFire: 0, projectId: null },
    roleId: null, concurrency: 'skip_if_active', status: 'active',
    lastFiredAt: null, nextFireAt: '2026-09-12T07:00:00.000Z', inFlightWakeId: null,
    createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', fireCount: 0,
    ...over,
  };
}

vi.mock('@tanstack/react-router', () => ({ Outlet: () => null, useRouterState: () => '/v2/scheduled', useParams: () => ({}) }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => ({}) }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspaces, isError: false }),
  useWorkers: () => ({ data: [] }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [] } }),
  useRoutinesMany: (ids: string[]) => ids.map((id) => ({ data: state.routines[id], isError: false })),
  useWorkspaceProjects: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { status: 'success', projects: state.projects[id] ?? [] }])),
  useRoutineUsageFor: () => ({ data: usageZeros(), isLoading: false }),
  useRoutineFires: () => ({ data: state.fires['rt_1'] ?? [], isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateRoutineAt: () => ({ mutate: (b: Record<string, unknown>) => state.creates.push(b), isPending: false }),
  usePatchRoutineAt: () => ({ mutate: (p: { ws: string; id: string; patch: Record<string, unknown> }) => state.patches.push(p), isPending: false }),
  useRemoveRoutineAt: () => ({ mutate: (p: { ws: string; id: string }) => state.removes.push(p), isPending: false }),
}));

const { V2Scheduled } = await import('../v2/scheduled/V2Scheduled');

beforeEach(() => {
  state.workspaces = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }];
  state.routines = { alpha: [], beta: [] };
  state.fires = {};
  state.projects = {};
  state.patches = [];
  state.removes = [];
  state.creates = [];
});

describe('V2 Scheduled', () => {
  it('lists tasks from every workspace with their scope', () => {
    state.routines = {
      alpha: [routine({ id: 'rt_a', name: 'Morning review' })],
      beta: [routine({ id: 'rt_b', workspaceId: 'beta', name: 'Nightly digest', template: { instruction: 'x', action: 'report', maxTicketsPerFire: 0, projectId: null } })],
    };
    render(<V2Scheduled />);
    expect(screen.getByText('Morning review')).toBeInTheDocument();
    expect(screen.getByText('Nightly digest')).toBeInTheDocument();
    expect(screen.getAllByText(/Alpha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Beta/).length).toBeGreaterThan(0);
  });

  it('renders the project in the project hue', () => {
    state.projects = { alpha: [{ id: 'p1', slug: 'web', name: 'web' }] };
    state.routines = { alpha: [routine({ template: { instruction: 'x', action: 'report', maxTicketsPerFire: 0, projectId: 'p1' } })], beta: [] };
    render(<V2Scheduled />);
    expect(screen.getByText('web').getAttribute('style')).toMatch(/color/);
  });

  it('creates a task from the add form', () => {
    state.workspaces = [{ id: 'alpha', name: 'Alpha' }];
    state.routines = { alpha: [] };
    render(<V2Scheduled />);
    fireEvent.change(screen.getByLabelText('New task name'), { target: { value: 'Digest' } });
    fireEvent.change(screen.getByLabelText('New instruction'), { target: { value: 'look' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add scheduled task' }));
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0]?.name).toBe('Digest');
  });

  it('pauses and removes a task from the expanded row', () => {
    state.routines = { alpha: [routine()], beta: [] };
    render(<V2Scheduled />);
    fireEvent.click(screen.getByText('Morning review'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(state.patches).toEqual([{ ws: 'alpha', id: 'rt_1', patch: { status: 'paused' } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(state.removes).toEqual([{ ws: 'alpha', id: 'rt_1' }]);
  });
});
