import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectConfigSchema } from '@weave-ai/shared';
import { ApiError } from '../api/client';

const state = vi.hoisted(() => ({
  patches: [] as Array<Record<string, unknown>>,
  projectPatches: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  projectPatchError: null as string | null,
  projects: [] as Array<Record<string, unknown>>,
  destProjects: [] as Array<Record<string, unknown>>,
  workers: [] as Array<{ projectId: string | null; status: string }>,
  removeCalls: [] as string[],
  removeError: null as unknown,
  moveArgs: [] as Array<{ destWs: string; project: Record<string, unknown> }>,
  moveWrites: [] as string[],
  moveMode: 'ok' as 'ok' | 'slug_clash' | 'add_fail' | 'archive_fail',
  config: {} as Record<string, unknown>,
  workspaces: [] as Array<Record<string, unknown>>,
  went: [] as string[],
  search: {} as Record<string, string | undefined>,
  telegramStatus: { configured: false, source: null as 'secret' | 'env' | null, botUsername: null as string | null },
  telegramSetCalls: [] as string[],
  telegramSetResult: null as { ok: true; botUsername: string | null } | { error: string } | null,
  telegramClearCalls: 0,
  telegramPending: [] as Array<{ externalUserId: string; username: string | null; displayName: string | null; firstSeenAt: string; lastSeenAt: string; attemptCount: number }>,
  approveCalls: [] as string[],
  disableAllowAllCalls: 0,
  toasts: [] as Array<{ title: string; detail?: string; status?: string }>,
  addCalls: [] as Array<Record<string, unknown>>,
  transcription: { backend: 'chrome' as 'chrome' | 'voxtype', model: null as string | null, voxtype: { installed: false, models: [] as Array<{ id: string; engine: string; installed: boolean }> } },
  transcriptionPuts: [] as Array<{ backend: 'chrome' | 'voxtype'; model?: string }>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  useGo: () => (to: string) => { state.went.push(to); },
  useSearchParams: () => state.search,
}));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: (t: { title: string; detail?: string; status?: string }) => state.toasts.push(t), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' }, config: state.config }, isLoading: false }),
  useWorkspaces: () => ({ data: state.workspaces }),
  usePatchConfig: () => ({
    mutate: (body: Record<string, unknown>) => state.patches.push(body),
    mutateAsync: async (body: Record<string, unknown>) => { state.patches.push(body); return {}; },
    isPending: false,
  }),
  useProjects: (wsOverride?: string) => ({
    data: wsOverride && wsOverride !== 'ws1' ? state.destProjects : state.projects,
    isLoading: false,
  }),
  useRuntimes: () => ({ data: [] }),
  useWorkers: () => ({ data: state.workers, isLoading: false }),
  useAddProject: () => ({
    mutate: (body: Record<string, unknown>) => { state.addCalls.push(body); },
    isPending: false,
  }),
  useRemoveProject: () => ({
    mutateAsync: async ({ id }: { id: string }) => {
      if (state.removeError) throw state.removeError;
      state.removeCalls.push(id);
    },
    isPending: false,
  }),
  useMoveProject: () => ({
    mutateAsync: async (args: { destWs: string; project: Record<string, unknown> }) => {
      const { MoveProjectError } = await import('../lib/moveProject');
      state.moveArgs.push(args);
      const destHas = state.destProjects.some((p) => p.slug === args.project['slug']);
      if (destHas || state.moveMode === 'slug_clash') {
        throw new MoveProjectError('slug_clash', `The destination already has a project named ${String(args.project['slug'])}`);
      }
      state.moveWrites.push('post');
      if (state.moveMode === 'add_fail') throw new MoveProjectError('add_failed', 'dest add failed');
      if (state.moveMode === 'archive_fail') throw new MoveProjectError('archive_failed', 'archive failed');
      state.moveWrites.push('delete');
    },
    isPending: false,
  }),
  usePatchProject: () => ({
    mutate: (p: { id: string; patch: Record<string, unknown> }, opts?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
      state.projectPatches.push(p);
      if (state.projectPatchError) opts?.onError?.(new Error(state.projectPatchError));
      else opts?.onSuccess?.();
    },
    mutateAsync: async (p: { id: string; patch: Record<string, unknown> }) => {
      state.projectPatches.push(p);
      if (state.projectPatchError) throw new Error(state.projectPatchError);
      return {};
    },
    isPending: false,
  }),
  useDaemonUpdate: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: undefined, isError: false }),
  useTelegramTokenStatus: () => ({ data: state.telegramStatus }),
  useSetTelegramToken: () => ({
    isPending: false,
    mutateAsync: async (token: string) => {
      state.telegramSetCalls.push(token);
      if (state.telegramSetResult && 'error' in state.telegramSetResult) throw new Error(state.telegramSetResult.error);
      return state.telegramSetResult ?? { ok: true, botUsername: 'acme_bot' };
    },
  }),
  useClearTelegramToken: () => ({
    isPending: false,
    mutateAsync: async () => { state.telegramClearCalls += 1; return { ok: true }; },
  }),
  useTelegramPending: () => ({ data: { pending: state.telegramPending } }),
  useApproveTelegramUser: () => ({
    isPending: false,
    mutateAsync: async (externalUserId: string) => { state.approveCalls.push(externalUserId); return { allowedUserIds: [] }; },
  }),
  useDisableTelegramAllowAll: () => ({
    isPending: false,
    mutateAsync: async () => { state.disableAllowAllCalls += 1; return { ok: true }; },
  }),
  useTranscription: () => ({ data: state.transcription, isLoading: false }),
  useSetTranscription: () => ({
    mutate: (body: { backend: 'chrome' | 'voxtype'; model?: string }) => {
      state.transcriptionPuts.push(body);
      state.transcription = {
        ...state.transcription,
        backend: body.backend,
        model: body.model ?? state.transcription.model,
      };
    },
    isPending: false,
  }),
  useDaemonModels: () => ({ data: { weaver: null, workers: null, workerOptions: null }, isLoading: false }),
  useSetDaemonModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRoutines: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRoutineUsage: () => ({ data: { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d' }, isLoading: false }),
  useCreateRoutine: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchRoutine: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveRoutine: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { WorkspaceSettingsRoute, DaemonSettingsRoute } = await import('../routes/Settings');

beforeEach(() => {
  state.patches = [];
  state.projectPatches = [];
  state.projectPatchError = null;
  state.projects = [];
  state.destProjects = [];
  state.workers = [];
  state.removeCalls = [];
  state.removeError = null;
  state.moveArgs = [];
  state.moveWrites = [];
  state.moveMode = 'ok';
  state.workspaces = [];
  state.went = [];
  state.search = {};
  state.config = {
    defaults: { bootstrapBudgetTokens: 16000, turnTimeoutSec: 2700, knowledgeBudgetTokens: { workspace: 10000, shared: 2000, decisions: 4000, project: 10000, document: 10000 } },
  };
  state.telegramStatus = { configured: false, source: null, botUsername: null };
  state.telegramSetCalls = [];
  state.telegramSetResult = null;
  state.telegramClearCalls = 0;
  state.telegramPending = [];
  state.approveCalls = [];
  state.disableAllowAllCalls = 0;
  state.toasts = [];
  state.addCalls = [];
  state.transcription = { backend: 'chrome', model: null, voxtype: { installed: false, models: [] } };
  state.transcriptionPuts = [];
});

describe('Settings — knowledge budgets', () => {
  it('shows every configured budget', () => {
    render(<WorkspaceSettingsRoute />);
    expect(screen.getByLabelText('Project knowledge base')).toHaveValue(10000);
    expect(screen.getByLabelText('Linked document')).toHaveValue(10000);
    expect(screen.getByLabelText('Shared conventions')).toHaveValue(2000);
    expect(screen.getByLabelText('Decision log')).toHaveValue(4000);
    expect(screen.getByLabelText('Bootstrap digest')).toHaveValue(16000);
  });

  it('patches only the budget that changed', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.patches).toEqual([{ defaults: { knowledgeBudgetTokens: { project: 25000 } } }]));
  });

  it('says nothing to the daemon when a budget is unchanged or not a sane token count', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText('Must be a whole number of at least 500')).toBeInTheDocument());
    expect(state.patches).toEqual([]);
  });

  it('an out-of-range value is rejected and keeps the typed number visible (VS-141 AC #3)', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText('Must be a whole number of at least 500')).toBeInTheDocument());
    expect(input).toHaveValue(12);
    expect(state.patches).toEqual([]);
  });

  it('shows a visible confirmation once a commit resolves, without reloading (VS-141 AC #2)', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('Enter commits the value without blurring (VS-141 AC #4)', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(state.patches).toEqual([{ defaults: { knowledgeBudgetTokens: { project: 25000 } } }]));
  });

  it('a dirty field survives switching sections without an explicit blur (VS-141 AC #1/#6)', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
    await waitFor(() => expect(state.patches).toEqual([{ defaults: { knowledgeBudgetTokens: { project: 25000 } } }]));
  });

  it('shows an unsaved indicator and an explicit save action while a field is dirty', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '25000' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.patches).toEqual([{ defaults: { knowledgeBudgetTokens: { project: 25000 } } }]));
  });
});

describe('Settings — YOLO mode', () => {
  it('reads off by default and turns the mode on', () => {
    render(<WorkspaceSettingsRoute />);
    const toggle = screen.getByLabelText('YOLO mode');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(state.patches).toEqual([{ defaults: { yolo: true } }]);
  });

  it('turns the mode off again when it is on', () => {
    state.config = { defaults: { yolo: true } };
    render(<WorkspaceSettingsRoute />);
    expect(screen.getByLabelText('YOLO mode')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByLabelText('YOLO mode'));
    expect(state.patches).toEqual([{ defaults: { yolo: false } }]);
  });

  it('overrides the mode per project and clears the override by dropping the key', () => {
    state.config = { defaults: { yolo: true } };
    state.projects = [{ id: 'p1', slug: 'api', status: 'ready', gitUrl: 'g', maxWorkers: 2, policies: { requireCi: true } }];
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const select = screen.getByLabelText('YOLO mode for api');
    expect(select).toHaveValue('inherit');

    fireEvent.change(select, { target: { value: 'off' } });
    expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { policies: { requireCi: true, yolo: false } } });

    state.projects = [{ ...state.projects[0]!, policies: { requireCi: true, yolo: false } }];
    fireEvent.change(screen.getByLabelText('YOLO mode for api'), { target: { value: 'inherit' } });
    expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { policies: { requireCi: true } } });
  });
});

describe('Settings — add project Auto-merge default (VS-153)', () => {
  function openProjects(): void {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
  }

  it('posts policies.autoMergeDefault false when the control is off, never top-level autoMerge', () => {
    openProjects();
    fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/api.git' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.addCalls).toHaveLength(1);
    const body = state.addCalls[0]!;
    expect(body).not.toHaveProperty('autoMerge');
    expect(body['policies']).toEqual({ autoMergeDefault: false });
  });

  it('posts policies.autoMergeDefault true when the control is on, never top-level autoMerge', () => {
    openProjects();
    fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/api.git' } });
    fireEvent.change(screen.getByLabelText('Auto-merge default'), { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.addCalls).toHaveLength(1);
    const body = state.addCalls[0]!;
    expect(body).not.toHaveProperty('autoMerge');
    expect(body['policies']).toEqual({ autoMergeDefault: true });
  });
});

describe('Settings — add project Max workers follows the project schema (VS-212)', () => {
  function openProjects(): void {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
  }

  // The bounds are read off the schema the route itself validates with, so a schema change the
  // form does not follow fails here.
  const maxWorkersSchema = ProjectConfigSchema.shape.maxWorkers.removeDefault();
  const min = maxWorkersSchema.minValue as number;
  const max = maxWorkersSchema.maxValue as number;

  it('flags an out-of-bounds value at the field while typing and disables Add', () => {
    openProjects();
    fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/api.git' } });

    const input = screen.getByLabelText('Max workers');
    fireEvent.change(input, { target: { value: String(max + 1) } });
    expect(screen.getByText(`A whole number from ${min} to ${max}.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add project' })).toBeDisabled();
    expect(state.addCalls).toHaveLength(0);

    fireEvent.change(input, { target: { value: String(min - 1) } });
    expect(screen.getByText(`A whole number from ${min} to ${max}.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add project' })).toBeDisabled();
  });

  it('a whole number at the schema maximum submits', () => {
    openProjects();
    fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/api.git' } });
    fireEvent.change(screen.getByLabelText('Max workers'), { target: { value: String(max) } });
    expect(screen.getByRole('button', { name: 'Add project' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.addCalls).toHaveLength(1);
    expect(state.addCalls[0]!['maxWorkers']).toBe(max);
  });
});

describe('Settings — a project landing branch (VS-122)', () => {
  beforeEach(() => {
    state.projects = [{ id: 'p1', slug: 'api', status: 'ready', gitUrl: 'g', maxWorkers: 2, defaultBranch: 'main', landingBranch: null, policies: {} }];
  });

  it('shows the default branch as a placeholder when none is declared, and sets one on blur', async () => {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'main');

    fireEvent.change(field, { target: { value: 'edge' } });
    fireEvent.blur(field);
    await waitFor(() => expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { landingBranch: 'edge' } }));
  });

  it('shows an already-declared landing branch and changes it on blur', async () => {
    state.projects = [{ ...state.projects[0]!, landingBranch: 'edge' }];
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    expect(field).toHaveValue('edge');

    fireEvent.change(field, { target: { value: 'staging' } });
    fireEvent.blur(field);
    await waitFor(() => expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { landingBranch: 'staging' } }));
  });

  it('clearing the field sends an empty string', async () => {
    state.projects = [{ ...state.projects[0]!, landingBranch: 'edge' }];
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    await waitFor(() => expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { landingBranch: '' } }));
  });

  it('a rejected branch keeps the typed value and states why, instead of reverting it (VS-141 AC #3)', async () => {
    state.projectPatchError = "branch 'nope' was not found on origin";
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.blur(field);

    await waitFor(() => expect(screen.getByText("branch 'nope' was not found on origin")).toBeInTheDocument());
    expect(field).toHaveValue('nope');
  });

  it('correcting and retrying after a rejection sends the corrected draft', async () => {
    state.projectPatchError = "branch 'nope' was not found on origin";
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.getByText("branch 'nope' was not found on origin")).toBeInTheDocument());

    state.projectPatchError = null;
    fireEvent.change(field, { target: { value: 'edge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { landingBranch: 'edge' } }));
  });

  it('Enter commits the value, on a phone keyboard exactly as on desktop (VS-141 AC #4)', async () => {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    fireEvent.change(field, { target: { value: 'edge' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { landingBranch: 'edge' } }));
  });

  it('a dirty landing-branch field survives switching sections without an explicit blur (VS-141 AC #1/#6)', async () => {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const field = screen.getByLabelText('landing branch for api');
    fireEvent.change(field, { target: { value: 'edge' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }));

    await waitFor(() => expect(state.projectPatches.at(-1)).toEqual({ id: 'p1', patch: { landingBranch: 'edge' } }));
  });
});

describe('Settings — the workspace name (VS-141)', () => {
  it('commits on blur', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByDisplayValue('Acme');
    fireEvent.change(input, { target: { value: 'Acme Renamed' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.patches).toEqual([{ name: 'Acme Renamed' }]));
  });

  it('rejects an empty name without touching the daemon, and keeps it correctable', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByDisplayValue('Acme');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText('Name cannot be empty')).toBeInTheDocument());
    expect(state.patches).toEqual([]);
  });

  it('a dirty name survives switching sections without an explicit blur', async () => {
    render(<WorkspaceSettingsRoute />);
    const input = screen.getByDisplayValue('Acme');
    fireEvent.change(input, { target: { value: 'Acme Renamed' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
    await waitFor(() => expect(state.patches).toEqual([{ name: 'Acme Renamed' }]));
  });
});

/** VS-46: the phone reaches the other workspaces through More, which opens Settings. */
describe('Settings — the workspace list', () => {
  const listItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '/tmp/ws1', projects: [], needsYou: 0, ...over,
  });

  it('is the first section on the page', () => {
    state.workspaces = [listItem()];
    const { container } = render(<WorkspaceSettingsRoute />);
    const labels = [...container.querySelectorAll('.ac-label')].map((el) => el.textContent);
    expect(labels[0]).toBe('Workspaces');
  });

  it('lists every workspace and marks the current one', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', ticketPrefix: 'BET' })];
    render(<WorkspaceSettingsRoute />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('shows each workspace its Needs-you count, and nothing at zero', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', needsYou: 4 })];
    render(<WorkspaceSettingsRoute />);
    expect(screen.getByLabelText('4 waiting for you')).toBeInTheDocument();
    expect(screen.queryByLabelText('0 waiting for you')).not.toBeInTheDocument();
  });

  it('navigates to a workspace that is chosen', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' })];
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByText('Beta'));
    expect(state.went).toContain('/w/beta/needs');
  });
});

/** VS-125: the Telegram bot token field, and the allowlist writing the field the channel reads. */
describe('Settings — Telegram', () => {
  const openChannels = (): void => {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));
  };

  it('saving a token clears the input and confirms the bot username', async () => {
    state.telegramSetResult = { ok: true, botUsername: 'acme_bot' };
    openChannels();
    const input = screen.getByLabelText('Bot token');
    fireEvent.change(input, { target: { value: 'a-real-looking-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state.telegramSetCalls).toEqual(['a-real-looking-token']));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Telegram token saved', detail: 'Confirmed as @acme_bot' });
  });

  it('a failed save leaves the input untouched and toasts the server error', async () => {
    state.telegramSetResult = { error: 'Telegram said: Unauthorized' };
    openChannels();
    const input = screen.getByLabelText('Bot token');
    fireEvent.change(input, { target: { value: 'a-bad-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state.telegramSetCalls).toEqual(['a-bad-token']));
    expect(input).toHaveValue('a-bad-token');
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Could not save the token', detail: 'Telegram said: Unauthorized' });
  });

  it('clearing calls the clear mutation and toasts confirmation', async () => {
    state.telegramStatus = { configured: true, source: 'secret', botUsername: 'acme_bot' };
    openChannels();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(state.telegramClearCalls).toBe(1));
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Telegram token cleared' });
  });

  it('Clear is disabled when nothing is configured', () => {
    state.telegramStatus = { configured: false, source: null, botUsername: null };
    openChannels();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('the allowlist field writes allowedUserIds, parsed to integers, dropping non-numeric entries', async () => {
    openChannels();
    const input = screen.getByLabelText('Allowlist');
    fireEvent.change(input, { target: { value: '111, not-a-number, 222' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.patches).toEqual([{ channels: { telegram: { allowedUserIds: [111, 222] } } }]));
  });

  it('Enter commits the allowlist without blurring (VS-141 AC #4)', async () => {
    openChannels();
    const input = screen.getByLabelText('Allowlist');
    fireEvent.change(input, { target: { value: '111, 222' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(state.patches).toEqual([{ channels: { telegram: { allowedUserIds: [111, 222] } } }]));
  });

  it('shows "Locked to N users" when the allowlist is populated', () => {
    state.config = { channels: { telegram: { allowedUserIds: [111, 222] } } };
    openChannels();
    expect(screen.getByText('Locked to 2 users')).toBeInTheDocument();
  });

  it('shows "Open to any Telegram user" when allowAll is set and the allowlist is empty', () => {
    state.config = { channels: { telegram: { allowedUserIds: [], allowAll: true } } };
    openChannels();
    expect(screen.getByText('Open to any Telegram user')).toBeInTheDocument();
  });

  it('shows "Off — no user is allowed" when the allowlist is empty and allowAll is not set', () => {
    state.config = { channels: { telegram: {} } };
    openChannels();
    expect(screen.getByText('Off — no user is allowed')).toBeInTheDocument();
  });

  it('there is no Enabled control (VS-135: the toggle was dead and is removed)', () => {
    openChannels();
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
  });
});

/** VS-135: pending identities and turning off legacy open access, both from the interface. */
describe('Settings — Telegram pending identities', () => {
  const openChannels = (): void => {
    render(<WorkspaceSettingsRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));
  };

  it('nothing renders when nobody is pending', () => {
    openChannels();
    expect(screen.queryByText('Waiting for approval')).not.toBeInTheDocument();
  });

  it('lists a pending identity by id, username, display name and attempt count — never message text', () => {
    state.telegramPending = [{ externalUserId: '99', username: 'stranger', displayName: 'Sam', firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-01T00:00:00.000Z', attemptCount: 3 }];
    openChannels();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('@stranger')).toBeInTheDocument();
    expect(screen.getByText(/3 attempts/)).toBeInTheDocument();
  });

  it('approving calls the approve mutation with the id and states the consequence', async () => {
    state.telegramPending = [{ externalUserId: '99', username: 'stranger', displayName: 'Sam', firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-01T00:00:00.000Z', attemptCount: 1 }];
    openChannels();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(state.approveCalls).toEqual(['99']));
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Approved', detail: 'They can now direct work in this workspace through the conductor.' });
  });

  it('no "Turn off open access" action when allowAll is not set', () => {
    state.config = { channels: { telegram: { allowedUserIds: [] } } };
    openChannels();
    expect(screen.queryByRole('button', { name: 'Turn off open access' })).not.toBeInTheDocument();
  });

  it('turning off open access calls the disable mutation', async () => {
    state.config = { channels: { telegram: { allowedUserIds: [], allowAll: true } } };
    openChannels();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off open access' }));
    await waitFor(() => expect(state.disableAllowAllCalls).toBe(1));
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Open access turned off' });
  });
});

describe('Settings — daemon dictation', () => {
  const open = (): void => {
    state.search = { section: 'dictation' };
    render(<DaemonSettingsRoute />);
  };

  it('defaults to Chrome and does not activate Voxtype when it is missing', () => {
    open();
    expect(screen.getByRole('radio', { name: 'Chrome' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Voxtype' }));
    expect(state.transcriptionPuts).toEqual([]);
    expect(screen.getByText(/Voxtype is not installed/)).toBeInTheDocument();
  });

  it('PUTs Voxtype and a model when installed', () => {
    state.transcription = {
      backend: 'chrome',
      model: null,
      voxtype: { installed: true, models: [{ id: 'base.en', engine: 'whisper', installed: true }] },
    };
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Voxtype' }));
    expect(state.transcriptionPuts).toEqual([{ backend: 'voxtype', model: 'base.en' }]);
  });

  it('keeps diagnostics on This device, on the daemon settings page (VS-230)', () => {
    state.search = { section: 'device' };
    render(<DaemonSettingsRoute />);
    expect(screen.getByLabelText('Dictation diagnostics capture')).toBeInTheDocument();
  });
});

describe('Settings — device push categories (VS-295)', () => {
  const openDevice = (): void => {
    state.search = { section: 'device' };
    render(<DaemonSettingsRoute />);
  };

  it('says decisions works and landed/everything do not send yet', () => {
    openDevice();
    expect(screen.getByText(/Plans, merges, hires, worker questions/).textContent).not.toMatch(/not sent yet/);
    expect(screen.getByText(/A PR merged, a ticket closed/).textContent).toMatch(/not sent yet/);
    expect(screen.getByText(/Status changes, run starts, curation/).textContent).toMatch(/not sent yet/);
  });

  it('pushes the new category set to the daemon when a toggle changes while subscribed', async () => {
    localStorage.setItem('conductor.push.ws1', 'sub_1');
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ id: 'sub_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.stubGlobal('Notification', { requestPermission: async () => 'granted', permission: 'granted' });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => ({ toJSON: () => ({ endpoint: 'https://push.example/dev-1', keys: { p256dh: 'k', auth: 'a' } }) }) },
        }),
      },
    });
    (window as unknown as { PushManager: unknown }).PushManager = class {};

    try {
      openDevice();
      fireEvent.click(screen.getByRole('switch', { name: 'Landed work' }));

      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.url).toContain('/push/subscriptions');
      expect(post?.body).toMatchObject({ endpoint: 'https://push.example/dev-1', categories: ['decisions'] });
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'serviceWorker');
      localStorage.clear();
    }
  });
});

function readyProject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    slug: 'api',
    name: 'API',
    status: 'ready',
    gitUrl: 'git@example.com:acme/api.git',
    maxWorkers: 2,
    defaultBranch: 'main',
    landingBranch: null,
    setupCommand: null,
    policies: {},
    ...over,
  };
}

function twoWorkspaces(): Array<Record<string, unknown>> {
  return [
    { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '/a', projects: [], needsYou: 0 },
    { id: 'ws2', name: 'fern-ofm', ticketPrefix: 'VOFM', root: '/b', projects: [], needsYou: 0 },
  ];
}

function openProjects(): void {
  render(<WorkspaceSettingsRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
}

describe('Settings — remove a project (VS-235)', () => {
  it('states archive semantics on confirm, then archives the project', async () => {
    state.projects = [readyProject()];
    openProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove api' });
    expect(dialog).toHaveTextContent('archived, not deleted');
    expect(dialog).toHaveTextContent('Tickets and knowledge stay in this workspace');
    expect(dialog).toHaveTextContent('The clone is left on disk');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(state.removeCalls).toEqual(['p1']));
  });

  it('shows an archived row without edit, remove, or move', () => {
    state.workspaces = twoWorkspaces();
    state.projects = [readyProject({ status: 'archived' })];
    openProjects();
    expect(screen.getByText('archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('landing branch for api')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('YOLO mode for api')).not.toBeInTheDocument();
  });

  it('disables Remove when workers are not retired or done, naming them', () => {
    state.projects = [readyProject()];
    state.workers = [{ projectId: 'p1', status: 'paused' }];
    openProjects();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByText('project api still has 1 live worker(s)')).toBeInTheDocument();
  });

  it('shows a DELETE conflict as the same reason, not a failure toast', async () => {
    state.projects = [readyProject()];
    state.removeError = new ApiError(409, { code: 'conflict', message: 'project api still has 1 live worker(s)' });
    openProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('project api still has 1 live worker(s)')).toBeInTheDocument());
    expect(state.removeCalls).toEqual([]);
    expect(state.toasts.filter((t) => t.status === 'failed')).toEqual([]);
  });
});

describe('Settings — move a project (VS-235)', () => {
  it('is not offered with only one workspace', () => {
    state.projects = [readyProject()];
    state.workspaces = [{ id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '/a', projects: [], needsYou: 0 }];
    openProjects();
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('names the destination and what stays, then POSTs dest before DELETEing source', async () => {
    state.workspaces = twoWorkspaces();
    state.projects = [readyProject({
      slug: 'vfuf',
      name: 'vfuf',
      gitUrl: 'git@example.com:v/vfuf.git',
      maxWorkers: 3,
      landingBranch: 'edge',
      setupCommand: 'pnpm i',
      policies: { autoMergeDefault: false },
    })];
    openProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.change(screen.getByLabelText('Destination workspace'), { target: { value: 'ws2' } });
    const dialog = screen.getByRole('dialog', { name: 'Move vfuf' });
    expect(dialog).toHaveTextContent('fern-ofm');
    expect(dialog).toHaveTextContent('stay in this workspace');
    expect(dialog).toHaveTextContent('The clone on disk here is left');
    expect(dialog).toHaveTextContent('fern-ofm clones afresh');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(state.moveWrites).toEqual(['post', 'delete']));
    expect(state.moveArgs[0]).toMatchObject({
      destWs: 'ws2',
      project: {
        id: 'p1',
        slug: 'vfuf',
        gitUrl: 'git@example.com:v/vfuf.git',
        name: 'vfuf',
        defaultBranch: 'main',
        landingBranch: 'edge',
        maxWorkers: 3,
        setupCommand: 'pnpm i',
        policies: { autoMergeDefault: false },
      },
    });
  });

  it('disables Move when workers are not retired or done', () => {
    state.workspaces = twoWorkspaces();
    state.projects = [readyProject()];
    state.workers = [{ projectId: 'p1', status: 'idle' }];
    openProjects();
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled();
    expect(screen.getByText('project api still has 1 live worker(s)')).toBeInTheDocument();
  });

  it('refuses a dest slug clash before either write', async () => {
    state.workspaces = twoWorkspaces();
    state.projects = [readyProject()];
    state.destProjects = [{ id: 'd1', slug: 'api', status: 'archived' }];
    openProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.change(screen.getByLabelText('Destination workspace'), { target: { value: 'ws2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('The destination already has a project named api')).toBeInTheDocument());
    expect(state.moveWrites).toEqual([]);
    expect(state.toasts.filter((t) => t.status === 'failed')).toEqual([]);
  });

  it('a dest-add failure leaves the source active and says to retry', async () => {
    state.workspaces = twoWorkspaces();
    state.projects = [readyProject()];
    state.moveMode = 'add_fail';
    openProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.change(screen.getByLabelText('Destination workspace'), { target: { value: 'ws2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText(/still in this workspace — retry Move/)).toBeInTheDocument());
    expect(state.moveWrites).toEqual(['post']);
  });

  it('an archive failure after dest add says dest already has it and to Remove here', async () => {
    state.workspaces = twoWorkspaces();
    state.projects = [readyProject()];
    state.moveMode = 'archive_fail';
    openProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.change(screen.getByLabelText('Destination workspace'), { target: { value: 'ws2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('fern-ofm already has this project. Remove it from this workspace.')).toBeInTheDocument());
    expect(state.moveWrites).toEqual(['post']);
  });
});
