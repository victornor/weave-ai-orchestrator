/** The runtime selector in Settings → Models reads detection.status, not a boolean (VS-45, VS-77). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeInfo } from '../api/types';

const state = vi.hoisted(() => ({ runtimes: [] as unknown[] }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => ({}) }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useRuntimes: () => ({ data: state.runtimes }),
  useModels: () => ({ data: { weaver: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null } }, isLoading: false }),
  useSetModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRuntimeModels: () => ({ data: [] }),
  useProjects: () => ({ data: [], isLoading: false }),
  useAddProject: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWorkers: () => ({ data: [], isLoading: false }),
  useWorkspaceSummary: () => ({ data: undefined, isLoading: false }),
  useWorkspaces: () => ({ data: [] }),
  usePatchConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonUpdate: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: undefined, isError: false }),
  useTranscription: () => ({ data: { backend: 'chrome', model: null, voxtype: { installed: false, models: [] } }, isLoading: false }),
  useSetTranscription: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonModels: () => ({ data: { weaver: null, workers: null, workerOptions: null }, isLoading: false }),
  useSetDaemonModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRoutines: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRoutineUsage: () => ({ data: { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d' }, isLoading: false }),
  useCreateRoutine: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchRoutine: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveRoutine: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { WorkspaceSettingsRoute: SettingsRoute } = await import('../routes/Settings');

const runtime = (id: string, detection: RuntimeInfo['detection']): RuntimeInfo => ({
  id, displayName: id, detection, capabilities: {},
});

/** Render Settings and switch to the Models tab, the way the operator gets there. */
function openModels(): void {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
}

/** Both settings offer the same runtimes, so a name matches twice; the conductor's is the first. */
function option(name: string): HTMLOptionElement {
  return screen.getAllByRole('option', { name })[0] as HTMLOptionElement;
}

beforeEach(() => {
  state.runtimes = [];
});

describe('Settings — the model settings runtime picker', () => {
  it('enables a runtime the daemon host detected', () => {
    state.runtimes = [runtime('claude', { status: 'available', version: '2.1.0' })];
    openModels();
    expect(option('claude').disabled).toBe(false);
  });

  it('disables and labels a runtime whose binary is missing', () => {
    state.runtimes = [runtime('codex', { status: 'missing_binary' })];
    openModels();
    expect(option('codex (not installed)').disabled).toBe(true);
  });

  it('says why a detected but broken runtime cannot be used', () => {
    state.runtimes = [runtime('gemini', { status: 'broken', notes: 'exited 1' })];
    openModels();
    expect(option('gemini (installed but not working)').disabled).toBe(true);
  });
});
