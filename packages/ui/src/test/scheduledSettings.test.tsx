/** Settings → Scheduled tasks: empty copy, listed row, pause, and 7d spend including zero (VS-220). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Routine, RoutineUsage } from '@agent-conductor/shared';

const state = vi.hoisted(() => ({
  items: [] as Routine[],
  usage: {} as Record<string, RoutineUsage>,
  patches: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  search: { section: 'scheduled' } as Record<string, string | undefined>,
}));

function usageZeros(over: Partial<RoutineUsage> = {}): RoutineUsage {
  return { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d', ...over };
}

function routine(over: Partial<Routine> = {}): Routine {
  return {
    id: 'rt_1',
    workspaceId: 'ws1',
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
    ...over,
  };
}

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => state.search }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useRoutines: () => ({ data: state.items, isLoading: false, isError: false, refetch: vi.fn() }),
  useRoutineUsage: (id: string) => ({ data: state.usage[id] ?? usageZeros(), isLoading: false }),
  useCreateRoutine: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchRoutine: () => ({
    mutate: (p: { id: string; patch: Record<string, unknown> }) => { state.patches.push(p); },
    isPending: false,
  }),
  useRemoveRoutine: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkspaceSummary: () => ({ data: undefined, isLoading: false }),
  useWorkspaces: () => ({ data: [] }),
  usePatchConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useProjects: () => ({ data: [], isLoading: false }),
  useAddProject: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: vi.fn(), isPending: false }),
  useRuntimes: () => ({ data: [] }),
  useRuntimeModels: () => ({ data: [] }),
  useModels: () => ({ data: { conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null } }, isLoading: false }),
  useSetModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  usePresentation: () => ({ data: { default: 'headless' }, isLoading: false, isError: false, refetch: vi.fn() }),
  usePresentationSurfaces: () => ({ data: { surfaces: ['headless'] } }),
  usePutPresentation: () => ({ mutate: vi.fn(), isPending: false }),
  useMe: () => ({ data: { totpEnabled: false, session: { id: 's1' } } }),
  useAuthSessions: () => ({ data: [], isLoading: false }),
  useDaemonUpdate: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: undefined, isError: false }),
  useRefreshDaemonUpdate: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
  useTelegramTokenStatus: () => ({ data: { configured: false, source: null, botUsername: null } }),
  useSetTelegramToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearTelegramToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTelegramPending: () => ({ data: { pending: [] } }),
  useApproveTelegramUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisableTelegramAllowAll: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTranscription: () => ({ data: { backend: 'chrome', model: null, voxtype: { installed: false, models: [] } }, isLoading: false }),
  useSetTranscription: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonModels: () => ({ data: { conductor: null, workers: null, workerOptions: null }, isLoading: false }),
  useSetDaemonModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const { WorkspaceSettingsRoute: SettingsRoute } = await import('../routes/Settings');

function openScheduled(): void {
  render(<SettingsRoute />);
}

beforeEach(() => {
  state.items = [];
  state.usage = {};
  state.patches = [];
  state.search = { section: 'scheduled' };
});

describe('Settings — scheduled tasks', () => {
  it('shows empty wording when this workspace has none', () => {
    openScheduled();
    expect(screen.getByText('No scheduled tasks yet.')).toBeInTheDocument();
    expect(screen.getByText(/Add one above, or ask the conductor/)).toBeInTheDocument();
  });

  it('lists a routine with its schedule, status, next due and 7d spend, including zero', () => {
    state.items = [routine()];
    state.usage = { rt_1: usageZeros() };
    openScheduled();
    expect(screen.getByText('Morning review')).toBeInTheDocument();
    expect(screen.getByText('daily 07:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText(/next 2026-09-12 07:00Z/)).toBeInTheDocument();
    expect(screen.getByText('7d $0.00')).toBeInTheDocument();
  });

  it('pauses from the listed row', () => {
    state.items = [routine()];
    openScheduled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(state.patches).toEqual([{ id: 'rt_1', patch: { status: 'paused' } }]);
  });
});
