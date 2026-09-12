/** The Presentation section in Settings renders the config the daemon actually returns (VS-50). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationConfig } from '../api/types';

const state = vi.hoisted(() => ({
  presentation: undefined as PresentationConfig | undefined,
  surfaces: [] as string[],
  put: vi.fn(),
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => ({}) }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  usePresentation: () => ({ data: state.presentation, isLoading: false, isError: false, refetch: vi.fn() }),
  usePresentationSurfaces: () => ({ data: { surfaces: state.surfaces } }),
  usePutPresentation: () => ({ mutate: state.put, isPending: false }),
  useRuntimes: () => ({ data: [] }),
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

/** Render Settings and switch to the Presentation tab, the way the operator gets there. */
function openPresentation(): void {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Presentation' }));
}

beforeEach(() => {
  state.presentation = { default: 'headless' };
  state.surfaces = ['headless', 'tmux', 'hyprland'];
  state.put.mockReset();
});

describe('Settings — presentation', () => {
  it('shows the stored default surface selected out of the daemon registry', () => {
    state.presentation = { default: 'tmux' };
    openPresentation();
    const select = screen.getByLabelText(/Default surface/) as HTMLSelectElement;
    expect(select.value).toBe('tmux');
    expect([...select.options].map((o) => o.value)).toEqual(['headless', 'tmux', 'hyprland']);
  });

  it('keeps a configured surface the daemon has no adapter for as an option', () => {
    state.presentation = { default: 'plugin-surface' };
    state.surfaces = ['headless'];
    openPresentation();
    const select = screen.getByLabelText(/Default surface/) as HTMLSelectElement;
    expect(select.value).toBe('plugin-surface');
    expect([...select.options].map((o) => o.value)).toEqual(['headless', 'plugin-surface']);
  });

  it('saves the whole config when the default changes, because PUT replaces it', () => {
    state.presentation = { default: 'headless', workers: { surface: 'tmux', session: 'ac' } };
    openPresentation();
    fireEvent.change(screen.getByLabelText(/Default surface/), { target: { value: 'hyprland' } });
    expect(state.put).toHaveBeenCalledWith({ default: 'hyprland', workers: { surface: 'tmux', session: 'ac' } });
  });

  it('renders the conductor and workers blocks, falling back to the default surface', () => {
    state.presentation = { default: 'headless', workers: { surface: 'tmux', session: 'ac' } };
    openPresentation();
    const row = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
    expect(row('Workers').textContent).toContain('tmux');
    expect(row('Workers').textContent).toContain('session: ac');
    // No conductor block: it inherits the default surface and says so.
    expect(row('Conductor').textContent).toContain('headless');
    expect(row('Conductor').textContent?.toLowerCase()).toContain('default');
  });
});
