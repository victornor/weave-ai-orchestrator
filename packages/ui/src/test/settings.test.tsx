import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patches: [] as Array<Record<string, unknown>>,
  projectPatches: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  projects: [] as Array<Record<string, unknown>>,
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
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  useGo: () => (to: string) => { state.went.push(to); },
  useSearchParams: () => state.search,
}));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: (t: { title: string; detail?: string; status?: string }) => state.toasts.push(t), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' }, config: state.config }, isLoading: false }),
  useWorkspaces: () => ({ data: state.workspaces }),
  usePatchConfig: () => ({ mutate: (body: Record<string, unknown>) => state.patches.push(body), isPending: false }),
  useProjects: () => ({ data: state.projects, isLoading: false }),
  useRuntimes: () => ({ data: [] }),
  useAddProject: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: (p: { id: string; patch: Record<string, unknown> }) => state.projectPatches.push(p), isPending: false }),
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
}));

const { SettingsRoute } = await import('../routes/Settings');

beforeEach(() => {
  state.patches = [];
  state.projectPatches = [];
  state.projects = [];
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
});

describe('Settings — knowledge budgets', () => {
  it('shows every configured budget', () => {
    render(<SettingsRoute />);
    expect(screen.getByLabelText('Project knowledge base')).toHaveValue(10000);
    expect(screen.getByLabelText('Linked document')).toHaveValue(10000);
    expect(screen.getByLabelText('Shared conventions')).toHaveValue(2000);
    expect(screen.getByLabelText('Decision log')).toHaveValue(4000);
    expect(screen.getByLabelText('Bootstrap digest')).toHaveValue(16000);
  });

  it('patches only the budget that changed', () => {
    render(<SettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.blur(input);
    expect(state.patches).toEqual([{ defaults: { knowledgeBudgetTokens: { project: 25000 } } }]);
  });

  it('says nothing to the daemon when a budget is unchanged or not a sane token count', () => {
    render(<SettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(state.patches).toEqual([]);
  });
});

describe('Settings — YOLO mode', () => {
  it('reads off by default and turns the mode on', () => {
    render(<SettingsRoute />);
    const toggle = screen.getByLabelText('YOLO mode');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(state.patches).toEqual([{ defaults: { yolo: true } }]);
  });

  it('turns the mode off again when it is on', () => {
    state.config = { defaults: { yolo: true } };
    render(<SettingsRoute />);
    expect(screen.getByLabelText('YOLO mode')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByLabelText('YOLO mode'));
    expect(state.patches).toEqual([{ defaults: { yolo: false } }]);
  });

  it('overrides the mode per project and clears the override by dropping the key', () => {
    state.config = { defaults: { yolo: true } };
    state.projects = [{ id: 'p1', slug: 'api', status: 'ready', gitUrl: 'g', maxWorkers: 2, policies: { requireCi: true } }];
    render(<SettingsRoute />);
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

/** VS-46: the phone reaches the other workspaces through More, which opens Settings. */
describe('Settings — the workspace list', () => {
  const listItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '/tmp/ws1', projects: [], needsYou: 0, ...over,
  });

  it('is the first section on the page', () => {
    state.workspaces = [listItem()];
    const { container } = render(<SettingsRoute />);
    const labels = [...container.querySelectorAll('.ac-label')].map((el) => el.textContent);
    expect(labels[0]).toBe('Workspaces');
  });

  it('lists every workspace and marks the current one', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', ticketPrefix: 'BET' })];
    render(<SettingsRoute />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('shows each workspace its Needs-you count, and nothing at zero', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', needsYou: 4 })];
    render(<SettingsRoute />);
    expect(screen.getByLabelText('4 waiting for you')).toBeInTheDocument();
    expect(screen.queryByLabelText('0 waiting for you')).not.toBeInTheDocument();
  });

  it('navigates to a workspace that is chosen', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' })];
    render(<SettingsRoute />);
    fireEvent.click(screen.getByText('Beta'));
    expect(state.went).toContain('/w/beta/needs');
  });
});

/** VS-125: the Telegram bot token field, and the allowlist writing the field the channel reads. */
describe('Settings — Telegram', () => {
  const openChannels = (): void => {
    render(<SettingsRoute />);
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

  it('the allowlist field writes allowedUserIds, parsed to integers, dropping non-numeric entries', () => {
    openChannels();
    const input = screen.getByLabelText('Allowlist');
    fireEvent.change(input, { target: { value: '111, not-a-number, 222' } });
    fireEvent.blur(input);
    expect(state.patches).toEqual([{ channels: { telegram: { allowedUserIds: [111, 222] } } }]);
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
    render(<SettingsRoute />);
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
