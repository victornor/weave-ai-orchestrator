/**
 * Settings → Models: the two settings, and the only place the web app offers a runtime or a model
 * to choose (VS-77).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceModels } from '../api/types';

const state = vi.hoisted(() => ({
  models: {} as WorkspaceModels,
  saved: [] as WorkspaceModels[],
  saveError: null as Error | null,
  runtimeModels: [] as Array<{ id: string; label: string }>,
  daemonModels: { conductor: null, workers: null, workerOptions: null } as {
    conductor: WorkspaceModels['conductor'] | null;
    workers: WorkspaceModels['workers'] | null;
    workerOptions: NonNullable<WorkspaceModels['workerOptions']> | null;
  },
  daemonSaved: [] as unknown[],
  search: { section: 'models' } as Record<string, string | undefined>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => state.search }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useModels: () => ({ data: state.models, isLoading: false }),
  useSetModels: () => ({
    mutate: (v: WorkspaceModels) => state.saved.push(v),
    mutateAsync: async (v: WorkspaceModels) => {
      state.saved.push(v);
      if (state.saveError) throw state.saveError;
      return v;
    },
    isPending: false,
    error: state.saveError,
  }),
  useRuntimes: () => ({ data: [
    { id: 'claude', displayName: 'Claude', detection: { status: 'available' }, capabilities: {} },
    { id: 'codex', displayName: 'Codex', detection: { status: 'available' }, capabilities: {} },
  ] }),
  useRuntimeModels: () => ({ data: state.runtimeModels }),
  useProjects: () => ({ data: [], isLoading: false }),
  useAddProject: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkspaceSummary: () => ({ data: undefined, isLoading: false }),
  useWorkspaces: () => ({ data: [] }),
  usePatchConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonUpdate: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: undefined, isError: false }),
  useTranscription: () => ({ data: { backend: 'chrome', model: null, voxtype: { installed: false, models: [] } }, isLoading: false }),
  useSetTranscription: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonModels: () => ({ data: state.daemonModels, isLoading: false }),
  useSetDaemonModels: () => ({
    mutate: (v: Partial<typeof state.daemonModels>) => { state.daemonSaved.push(v); state.daemonModels = { ...state.daemonModels, ...v }; },
    isPending: false,
    error: null,
  }),
}));

const { SettingsRoute } = await import('../routes/Settings');

beforeEach(() => {
  state.models = { conductor: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } };
  state.saved = [];
  state.saveError = null;
  state.runtimeModels = [{ id: 'claude-fable-5-1', label: 'Fable 5.1' }, { id: 'claude-opus-5', label: 'Opus 5' }];
  state.daemonModels = { conductor: null, workers: null, workerOptions: null };
  state.daemonSaved = [];
  state.search = { section: 'models' };
});

function openModels(): void {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
}

describe('Settings — the two model settings', () => {
  it('shows both, each with its runtime and its model', () => {
    openModels();
    expect(screen.getByLabelText('Conductor runtime')).toHaveValue('claude');
    expect(screen.getByLabelText('Conductor model')).toHaveValue('claude-fable-5-1');
    expect(screen.getByLabelText('Workers runtime')).toHaveValue('claude');
    // Null means the runtime chooses, which the picker says rather than showing an empty box.
    expect(screen.getByLabelText('Workers model')).toHaveValue('');
    expect(within(screen.getByLabelText('Workers model')).getByRole('option', { name: 'default (the runtime chooses)' })).toBeInTheDocument();
  });

  it('sends the whole block when one setting changes, so the other is not dropped', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('Workers runtime'), { target: { value: 'codex' } });
    expect(state.saved).toEqual([{
      conductor: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'codex', model: null },
    }]);
  });

  it('changes the conductor without touching the workers', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: 'claude-opus-5' } });
    expect(state.saved[0]!.conductor.model).toBe('claude-opus-5');
    expect(state.saved[0]!.workers).toEqual({ runtime: 'claude', model: null });
  });

  it('clears a model back to the runtime default with null, not an empty string', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: '' } });
    expect(state.saved[0]!.conductor.model).toBeNull();
  });

  it('takes a model the runtime does not list', async () => {
    openModels();
    fireEvent.change(screen.getByLabelText('Workers model'), { target: { value: '__other' } });
    const box = screen.getByLabelText('Workers model id');
    fireEvent.change(box, { target: { value: 'some-unlisted-model' } });
    fireEvent.blur(box);
    await waitFor(() => expect(state.saved[0]?.workers.model).toBe('some-unlisted-model'));
  });

  it('reveals the free-text box for a stored model the runtime does not list', () => {
    state.models = { ...state.models, workers: { runtime: 'claude', model: 'a-model-nobody-lists' } };
    openModels();
    expect(screen.getByLabelText('Workers model id')).toHaveValue('a-model-nobody-lists');
  });

  it('keeps a runtime the daemon no longer reports rather than silently switching it', () => {
    state.models = { ...state.models, workers: { runtime: 'gemini', model: null } };
    openModels();
    const select = screen.getByLabelText('Workers runtime');
    expect(select).toHaveValue('gemini');
    expect(within(select).getByRole('option', { name: 'gemini (not installed)' })).toBeInTheDocument();
  });

  it('says the change did not stick when the daemon refuses it', () => {
    state.saveError = new Error('runtime: kebab-case slug');
    openModels();
    expect(screen.getByRole('alert')).toHaveTextContent('runtime: kebab-case slug');
  });

  it('shows worker options and adding one PUTs the full block (VS-162)', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('New worker option id'), { target: { value: 'cheap' } });
    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: 'Scouts and low complexity.' } });
    fireEvent.change(screen.getByLabelText('New worker option runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('New worker option model'), { target: { value: 'gpt-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved.at(-1)).toEqual({
      conductor: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'claude', model: null },
      workerOptions: [{ id: 'cheap', description: 'Scouts and low complexity.', runtime: 'codex', model: 'gpt-5' }],
    });
  });

  it('removes a worker option and preserves the catalog when the conductor setting changes (VS-162)', () => {
    const cheap = { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' };
    state.models = { ...state.models, workerOptions: [cheap] };
    openModels();
    expect(screen.getByText(/cheap — Scouts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove worker option cheap' }));
    expect(state.saved.at(-1)!.workerOptions).toEqual([]);
    state.saved = [];
    state.models = { ...state.models, workerOptions: [cheap] };
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: 'claude-opus-5' } });
    expect(state.saved.at(-1)!.workerOptions).toEqual([cheap]);
  });

  it('disables a locked conductor control (VS-185)', () => {
    state.models = {
      ...state.models,
      locked: { conductor: true, workers: false, workerOptions: false },
    };
    openModels();
    expect(screen.getByLabelText('Conductor runtime')).toBeDisabled();
    expect(screen.getByLabelText('Workers runtime')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Workers runtime'), { target: { value: 'codex' } });
    expect(state.saved.at(-1)?.workers.runtime).toBe('codex');
  });

  it('opens daemon Models from This daemon and PUTs an overlay (VS-185)', () => {
    state.search = { section: 'daemon-models' };
    render(<SettingsRoute />);
    fireEvent.change(screen.getByLabelText('Conductor runtime'), { target: { value: 'codex' } });
    expect(state.daemonSaved.at(-1)).toMatchObject({ conductor: { runtime: 'codex' } });
  });

  it('is the only place Settings offers a runtime or a model', () => {
    render(<SettingsRoute />);
    // The conductor section is gone: its only settings were these two.
    expect(screen.queryByRole('tab', { name: 'Conductor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
    expect(screen.queryByLabelText('Runtime')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
  });
});
