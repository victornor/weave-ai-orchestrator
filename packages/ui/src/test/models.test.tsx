/**
 * Settings → Models: the two settings, and the only place the web app offers a runtime or a model
 * to choose (VS-77).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerModelOptionSchema, WorkerOptionsArraySchema } from '@weave-ai/shared';
import type { WorkspaceModels } from '../api/types';

const state = vi.hoisted(() => ({
  models: {} as WorkspaceModels,
  saved: [] as WorkspaceModels[],
  saveError: null as Error | null,
  runtimeModels: [] as Array<{ id: string; label: string; efforts?: string[] }>,
  daemonModels: { weaver: null, workers: null, workerOptions: null } as {
    weaver: WorkspaceModels['weaver'] | null;
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
  useModelsOptional: () => ({ data: state.models, isLoading: false }),
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
  useDaemonModels: () => ({ data: state.daemonModels, isLoading: false }),
  useSetDaemonModels: () => ({
    mutate: (v: Partial<typeof state.daemonModels>) => { state.daemonSaved.push(v); state.daemonModels = { ...state.daemonModels, ...v }; },
    isPending: false,
    error: null,
  }),
  useRoutines: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRoutineUsage: () => ({ data: { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d' }, isLoading: false }),
  useCreateRoutine: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchRoutine: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveRoutine: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { DaemonSettingsRoute, WorkspaceSettingsRoute } = await import('../routes/Settings');

beforeEach(() => {
  state.models = { weaver: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } };
  state.saved = [];
  state.saveError = null;
  state.runtimeModels = [{ id: 'claude-fable-5-1', label: 'Fable 5.1' }, { id: 'claude-opus-5', label: 'Opus 5' }];
  state.daemonModels = { weaver: null, workers: null, workerOptions: null };
  state.daemonSaved = [];
  state.search = { section: 'models' };
});

function openModels(): void {
  render(<WorkspaceSettingsRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
}

function openDaemonModels(): void {
  render(<DaemonSettingsRoute />);
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
      weaver: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'codex', model: null },
    }]);
  });

  it('changes the weaver without touching the workers', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: 'claude-opus-5' } });
    expect(state.saved[0]!.weaver.model).toBe('claude-opus-5');
    expect(state.saved[0]!.workers).toEqual({ runtime: 'claude', model: null });
  });

  it('clears a model back to the runtime default with null, not an empty string', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: '' } });
    expect(state.saved[0]!.weaver.model).toBeNull();
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
    // 'gpt-5' is not in the mocked catalog for any runtime here, so it goes through the escape hatch.
    fireEvent.change(screen.getByLabelText('New worker option model'), { target: { value: '__other' } });
    fireEvent.change(screen.getByLabelText('New worker option model id'), { target: { value: 'gpt-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved.at(-1)).toEqual({
      weaver: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'claude', model: null },
      workerOptions: [{ id: 'cheap', description: 'Scouts and low complexity.', runtime: 'codex', model: 'gpt-5' }],
    });
  });

  it('the new worker option model field is a picker over the catalog, with an explicit runtime-default entry (VS-207)', () => {
    openModels();
    const select = screen.getByLabelText('New worker option model');
    expect(within(select).getByRole('option', { name: 'runtime default' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Fable 5.1 (claude-fable-5-1)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'claude-opus-5' } });
    fireEvent.change(screen.getByLabelText('New worker option id'), { target: { value: 'strong' } });
    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: 'Hard tickets.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'strong', description: 'Hard tickets.', runtime: 'claude', model: 'claude-opus-5' },
    ]);
  });

  it('leaving the new worker option model at runtime default stores null (VS-207)', () => {
    openModels();
    fireEvent.change(screen.getByLabelText('New worker option id'), { target: { value: 'cheap' } });
    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: 'Scouts.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved.at(-1)!.workerOptions).toEqual([{ id: 'cheap', description: 'Scouts.', runtime: 'claude', model: null }]);
  });

  it('removes a worker option and preserves the catalog when the weaver setting changes (VS-162)', () => {
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

  it('an unconfigured option row does not select claude and disables the model until a runtime is chosen (VS-236)', () => {
    state.models = {
      ...state.models,
      workerOptions: [{ id: 'quick', description: 'Fastest.', runtime: null, model: null }],
    };
    openModels();
    expect(screen.getByText(/quick — Fastest/)).toBeInTheDocument();
    const runtime = screen.getByLabelText('quick runtime');
    expect(runtime).toHaveValue('');
    expect(within(runtime).getByRole('option', { name: 'Not chosen' })).toBeInTheDocument();
    expect(screen.getByLabelText('quick model')).toBeDisabled();
    fireEvent.change(runtime, { target: { value: 'codex' } });
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'quick', description: 'Fastest.', runtime: 'codex', model: null },
    ]);
  });

  it('a workspace control is never disabled, even while a daemon overlay is filled for it (VS-284)', () => {
    // `useModels()` already returns the effective value; a filled daemon overlay for weaver would
    // surface here as `current.weaver` reflecting the overlay, never as a `locked` flag.
    openModels();
    expect(screen.getByLabelText('Conductor runtime')).not.toBeDisabled();
    expect(screen.getByLabelText('Workers runtime')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Conductor runtime'), { target: { value: 'codex' } });
    expect(state.saved.at(-1)?.weaver.runtime).toBe('codex');
    fireEvent.change(screen.getByLabelText('Workers runtime'), { target: { value: 'codex' } });
    expect(state.saved.at(-1)?.workers.runtime).toBe('codex');
  });

  it('opens daemon Models inheriting by default, stating the workspace value inherited (VS-207)', () => {
    state.search = { section: 'daemon-models' };
    openDaemonModels();
    const scope = screen.getByLabelText('Conductor scope');
    expect(scope).toHaveValue('inherit');
    expect(within(scope).getByRole('option', { name: 'Inherit — claude · claude-fable-5-1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Conductor runtime')).toBeDisabled();
    expect(screen.getByLabelText('Conductor runtime')).toHaveValue('claude');
  });

  it('opening or changing an inheriting daemon row writes nothing (VS-207)', () => {
    state.search = { section: 'daemon-models' };
    openDaemonModels();
    fireEvent.change(screen.getByLabelText('Conductor runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: 'claude-opus-5' } });
    expect(state.daemonSaved).toEqual([]);
  });

  it('choosing Override is the deliberate act that creates the daemon overlay, seeded from the inherited value (VS-207)', () => {
    state.search = { section: 'daemon-models' };
    openDaemonModels();
    fireEvent.change(screen.getByLabelText('Conductor scope'), { target: { value: 'override' } });
    expect(state.daemonSaved.at(-1)).toEqual({ weaver: { runtime: 'claude', model: 'claude-fable-5-1' } });
  });

  it('once overridden, the row is editable and edits write the overlay directly (VS-185)', () => {
    state.search = { section: 'daemon-models' };
    state.daemonModels = { ...state.daemonModels, weaver: { runtime: 'codex', model: null } };
    openDaemonModels();
    expect(screen.getByLabelText('Conductor scope')).toHaveValue('override');
    expect(screen.getByLabelText('Conductor runtime')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Conductor runtime'), { target: { value: 'claude' } });
    expect(state.daemonSaved.at(-1)).toMatchObject({ weaver: { runtime: 'claude' } });
  });

  it('choosing Inherit clears an overridden overlay through the scope select, with no separate button (VS-207)', () => {
    state.search = { section: 'daemon-models' };
    state.daemonModels = { ...state.daemonModels, weaver: { runtime: 'codex', model: 'gpt-5' } };
    openDaemonModels();
    expect(screen.queryByRole('button', { name: 'Clear Conductor overlay' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Conductor scope'), { target: { value: 'inherit' } });
    expect(state.daemonSaved.at(-1)).toEqual({ weaver: null });
  });

  it('is the only place Settings offers a runtime or a model', () => {
    render(<WorkspaceSettingsRoute />);
    // The weaver section is gone: its only settings were these two.
    expect(screen.queryByRole('tab', { name: 'Conductor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
    expect(screen.queryByLabelText('Runtime')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
  });
});

describe('Settings — thinking level next to the model (VS-228)', () => {
  it('offers a picker (plus unset) when the selected model lists efforts', () => {
    state.runtimeModels = [
      { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'medium', 'high'] },
      { id: 'claude-opus-5', label: 'Opus 5', efforts: ['low'] },
    ];
    openModels();
    const select = screen.getByLabelText('Conductor thinking level');
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getByRole('option', { name: 'default (unset)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'high' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'high' } });
    expect(state.saved.at(-1)!.weaver.effort).toBe('high');
    fireEvent.change(select, { target: { value: '' } });
    expect(state.saved.at(-1)!.weaver.effort).toBeUndefined();
  });

  it('hides thinking level when the model reports none', () => {
    state.runtimeModels = [
      { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: [] },
      { id: 'claude-opus-5', label: 'Opus 5', efforts: [] },
    ];
    openModels();
    expect(screen.queryByLabelText('Conductor thinking level')).not.toBeInTheDocument();
  });

  it('uses free text when the model omits efforts', () => {
    openModels();
    expect(screen.getByLabelText('Conductor thinking level').tagName).toBe('INPUT');
  });

  it('clears a stale effort when the model changes to one that does not list it', () => {
    state.models = { ...state.models, weaver: { runtime: 'claude', model: 'claude-fable-5-1', effort: 'high' } };
    state.runtimeModels = [
      { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'medium', 'high'] },
      { id: 'claude-opus-5', label: 'Opus 5', efforts: ['low'] },
    ];
    openModels();
    fireEvent.change(screen.getByLabelText('Conductor model'), { target: { value: 'claude-opus-5' } });
    expect(state.saved.at(-1)!.weaver).toEqual({ runtime: 'claude', model: 'claude-opus-5', effort: undefined });
  });

  it('shows a stale stored effort as free text rather than dropping it', () => {
    state.models = { ...state.models, weaver: { runtime: 'claude', model: 'claude-fable-5-1', effort: 'ultra' } };
    state.runtimeModels = [
      { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'medium', 'high'] },
      { id: 'claude-opus-5', label: 'Opus 5' },
    ];
    openModels();
    const box = screen.getByLabelText('Conductor thinking level');
    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveValue('ultra');
  });

  it('submits effort on a new worker option when picked, and omits it when hidden or unset', () => {
    state.runtimeModels = [
      { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'high'] },
      { id: 'claude-opus-5', label: 'Opus 5', efforts: [] },
    ];
    openModels();
    fireEvent.change(screen.getByLabelText('New worker option id'), { target: { value: 'thinky' } });
    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: 'Needs high thinking.' } });
    fireEvent.change(screen.getByLabelText('New worker option model'), { target: { value: 'claude-fable-5-1' } });
    fireEvent.change(screen.getByLabelText('New worker option thinking level'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'thinky', description: 'Needs high thinking.', runtime: 'claude', model: 'claude-fable-5-1', effort: 'high' },
    ]);

    state.saved = [];
    state.models = { ...state.models, workerOptions: [] };
    fireEvent.change(screen.getByLabelText('New worker option id'), { target: { value: 'quiet' } });
    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: 'No thinking.' } });
    fireEvent.change(screen.getByLabelText('New worker option model'), { target: { value: 'claude-opus-5' } });
    expect(screen.queryByLabelText('New worker option thinking level')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'quiet', description: 'No thinking.', runtime: 'claude', model: 'claude-opus-5' },
    ]);
  });

  it('changing thinking level while inheriting a daemon overlay writes nothing (VS-207)', () => {
    state.search = { section: 'daemon-models' };
    state.runtimeModels = [
      { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'high'] },
      { id: 'claude-opus-5', label: 'Opus 5' },
    ];
    openDaemonModels();
    fireEvent.change(screen.getByLabelText('Conductor thinking level'), { target: { value: 'high' } });
    expect(state.daemonSaved).toEqual([]);
  });
});

describe('Settings — the add-option editor enforces the catalog rules before submit (VS-212)', () => {
  function typeEntry(id: string, description: string): void {
    fireEvent.change(screen.getByLabelText('New worker option id'), { target: { value: id } });
    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: description } });
  }

  it('flags an over-length description at the field while typing and disables Add, at the schema’s own limit', () => {
    // The limit is read off the schema, so a schema change the editor does not follow fails here.
    const max = WorkerModelOptionSchema.shape.description.maxLength;
    expect(typeof max).toBe('number');
    openModels();
    typeEntry('cheap', 'x'.repeat((max as number) + 1));
    expect(screen.getByText(`At most ${max} characters — now ${(max as number) + 1}.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add worker option' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New worker option description'), { target: { value: 'x'.repeat(max as number) } });
    expect(screen.queryByText(`At most ${max} characters — now ${(max as number) + 1}.`)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add worker option' })).toBeEnabled();
  });

  it('flags a duplicate id at the id field before any submit', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'cheap', description: 'Scouts.', runtime: 'claude', model: null }] };
    openModels();
    typeEntry('cheap', 'Also scouts.');
    expect(screen.getByText(/duplicate worker option id 'cheap'/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add worker option' })).toBeDisabled();
    expect(state.saved).toHaveLength(0);
  });

  it('flags an id the slug rule rejects at the id field', () => {
    openModels();
    typeEntry('Cheap Model', 'Scouts.');
    expect(screen.getByText('Kebab-case — lowercase letters, digits and dashes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add worker option' })).toBeDisabled();
  });

  it('says the catalog cap and disables Add once the catalog is full, whatever the typed entry', () => {
    // The fixture count is probed off the schema, so no restated literal can drift from it here.
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `option-${i}`, description: `Number ${i}.`, runtime: 'claude', model: null }));
    let cap = 0;
    while (WorkerOptionsArraySchema.safeParse(make(cap + 1)).success) cap++;
    state.models = { ...state.models, workerOptions: make(cap) };
    openModels();
    typeEntry('one-more', 'Still valid on its own.');
    expect(screen.getByText(/at most/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add worker option' })).toBeDisabled();
    expect(state.saved).toHaveLength(0);
  });

  it('keeps Add disabled on an untouched form, instead of no-oping on click', () => {
    openModels();
    expect(screen.getByRole('button', { name: 'Add worker option' })).toBeDisabled();
    expect(screen.getByText('An id and a when-to-use description are required; the id is kebab-case and unique in the catalog.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add worker option' }));
    expect(state.saved).toHaveLength(0);
  });
});

describe('Settings — an existing worker option row shows its thinking level (VS-252)', () => {
  const fableAndOpus = [
    { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'medium', 'high'] },
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['low'] },
  ];

  it('shows the stored effort and saves a change, keeping id and description', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'tier', description: 'Hard tickets.', runtime: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
    state.runtimeModels = fableAndOpus;
    openModels();
    const select = screen.getByLabelText('tier thinking level');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('high');
    expect(within(select).getByRole('option', { name: 'default (unset)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'low' } });
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'tier', description: 'Hard tickets.', runtime: 'claude', model: 'claude-fable-5-1', effort: 'low' },
    ]);
  });

  it('renders an option with no effort as unset rather than implying one', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'tier', description: 'No effort.', runtime: 'claude', model: 'claude-fable-5-1' }] };
    state.runtimeModels = fableAndOpus;
    openModels();
    const select = screen.getByLabelText('tier thinking level');
    expect(select).toHaveValue('');
    expect(within(select).getByRole('option', { name: 'default (unset)' })).toBeInTheDocument();
  });

  it('hides the control when the option model reports no efforts', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'tier', description: 'No thinking.', runtime: 'claude', model: 'claude-opus-5' }] };
    state.runtimeModels = [{ id: 'claude-opus-5', label: 'Opus 5', efforts: [] }];
    openModels();
    expect(screen.queryByLabelText('tier thinking level')).not.toBeInTheDocument();
  });

  it('offers free text when the option model is not listed', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'tier', description: 'Unlisted.', runtime: 'claude', model: 'a-model-nobody-lists', effort: 'high' }] };
    state.runtimeModels = [{ id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['low', 'high'] }];
    openModels();
    const box = screen.getByLabelText('tier thinking level');
    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveValue('high');
  });

  it('shows no thinking-level control while the option has no runtime', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'quick', description: 'Fastest.', runtime: null, model: null }] };
    state.runtimeModels = fableAndOpus;
    openModels();
    expect(screen.getByText(/quick — Fastest/)).toBeInTheDocument();
    expect(screen.queryByLabelText('quick thinking level')).not.toBeInTheDocument();
  });

  it('announces an effort a model change discards, and stores it cleared', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'tier', description: 'Hard tickets.', runtime: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
    state.runtimeModels = fableAndOpus;
    openModels();
    fireEvent.change(screen.getByLabelText('tier model'), { target: { value: 'claude-opus-5' } });
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'tier', description: 'Hard tickets.', runtime: 'claude', model: 'claude-opus-5', effort: undefined },
    ]);
    expect(screen.getByText(/“high” was cleared/)).toBeInTheDocument();
  });

  it('stays quiet when a model change keeps the effort', () => {
    state.models = { ...state.models, workerOptions: [{ id: 'tier', description: 'Hard tickets.', runtime: 'claude', model: 'claude-fable-5-1', effort: 'low' }] };
    state.runtimeModels = fableAndOpus;
    openModels();
    fireEvent.change(screen.getByLabelText('tier model'), { target: { value: 'claude-opus-5' } });
    expect(state.saved.at(-1)!.workerOptions).toEqual([
      { id: 'tier', description: 'Hard tickets.', runtime: 'claude', model: 'claude-opus-5', effort: 'low' },
    ]);
    expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument();
  });
});
