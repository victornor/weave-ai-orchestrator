import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patches: [] as Array<Record<string, unknown>>,
  projectPatches: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  projects: [] as Array<Record<string, unknown>>,
  config: {} as Record<string, unknown>,
  workspaces: [] as Array<Record<string, unknown>>,
  went: [] as string[],
  search: {} as Record<string, string | undefined>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  useGo: () => (to: string) => { state.went.push(to); },
  useSearchParams: () => state.search,
}));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
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
