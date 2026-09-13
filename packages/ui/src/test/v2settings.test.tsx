/** V2 Settings (VS-348): the scope/section rows, the kept sections, and the override diff/reset. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { V2_DAEMON_SECTIONS, V2_WORKSPACE_SECTIONS } from '../v2/settings/sections';

const state = vi.hoisted(() => ({
  go: [] as Array<{ to: string; search?: Record<string, unknown> }>,
  search: {} as Record<string, string | undefined>,
  modelWrites: [] as unknown[],
  daemonWrites: [] as unknown[],
  plugins: [] as Array<{ id: string; version: string | null; source: string; loaded: boolean; error: string | null }>,
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/v2/settings',
  useParams: () => ({}),
}));

vi.mock('../app/link', () => ({
  A: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useGo: () => (to: string, opts?: { search?: Record<string, unknown> }) => { state.go.push({ to, ...(opts ?? {}) }); },
  useSearchParams: () => state.search,
}));

vi.mock('../api/context', () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useWs: () => 'acme',
  useHookWs: () => 'acme',
  useOptionalWorkspace: () => null,
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [
    { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 0 },
    { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
  ] }),
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [] } }),
  useRuntimes: () => ({ data: [{ id: 'claude', displayName: 'Claude Code', detection: { status: 'available' }, capabilities: {} }] }),
  useRuntimeModels: () => ({ data: [] }),
  useDaemonModels: () => ({ data: { weaver: { runtime: 'claude', model: 'opus', effort: 'high' }, workers: null, workerOptions: null } }),
  useSetDaemonModels: () => ({ mutate: (v: unknown) => state.daemonWrites.push(v) }),
  useModels: () => ({ isLoading: false, data: {
    weaver: { runtime: 'claude', model: 'opus', effort: 'max' },
    workers: { runtime: 'claude', model: 'sonnet', effort: 'high' },
    workerOptions: [],
  } }),
  useSetModels: () => ({ mutate: (v: unknown) => state.modelWrites.push(v) }),
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'acme', name: 'Acme', ticketPrefix: 'ACME' }, config: {}, plugins: state.plugins } }),
  usePatchConfig: () => ({ mutate: () => undefined, mutateAsync: async () => undefined }),
}));

vi.mock('../routes/Settings', () => ({
  UpdatesSection: () => <div>updates-body</div>,
  SecuritySection: () => <div>security-body</div>,
  HostToolsSection: () => <div>host-tools-body</div>,
  DictationSection: () => <div>dictation-body</div>,
  DeviceSection: ({ themeControl }: { themeControl?: string }) => <div>device-{themeControl ?? 'full'}-body</div>,
  ProjectsSection: () => <div>projects-body</div>,
  ChannelsSection: () => <div>channels-body</div>,
  PresentationSection: () => <div>presentation-body</div>,
  KnowledgeBudgetsSection: () => <div>budgets-body</div>,
  YoloSection: () => <div>yolo-body</div>,
}));

const { V2Settings } = await import('../v2/settings/V2Settings');

beforeEach(() => {
  state.go = [];
  state.search = {};
  state.modelWrites = [];
  state.daemonWrites = [];
  state.plugins = [];
});

describe('the V2 Settings scope and section rows', () => {
  it('shows the daemon sections and the applies-to line by default', () => {
    render(<V2Settings />);
    expect(screen.getByText('This daemon — applies to every workspace on this machine.')).toBeInTheDocument();
    for (const label of ['Updates', 'Models', 'Security & devices', 'Host tools', 'Dictation', 'This device']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('updates-body')).toBeInTheDocument();
  });

  it('shows the workspace sections and names the workspace when a scope is selected', () => {
    state.search = { scope: 'acme' };
    render(<V2Settings />);
    expect(screen.getByText('Acme — applies to this workspace only.')).toBeInTheDocument();
    for (const label of ['General', 'Weaver', 'Models', 'Projects', 'Knowledge', 'Approvals', 'Channels', 'Presentation', 'Plugins']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('switches scope by writing the URL and resetting the section', () => {
    render(<V2Settings />);
    fireEvent.click(screen.getByText('Beta'));
    expect(state.go.at(-1)).toEqual({ to: '/v2/settings', search: { scope: 'beta' }, replace: true });
  });

  it('never offers a Budget section in either scope', () => {
    render(<V2Settings />);
    expect(screen.queryByText('Budget')).toBeNull();
    state.search = { scope: 'acme' };
    render(<V2Settings />);
    expect(screen.queryByText('Budget')).toBeNull();
  });
});

describe('every listed section renders a real body', () => {
  const expected: Record<string, string> = {
    updates: 'updates-body', security: 'security-body', 'host-tools': 'host-tools-body',
    dictation: 'dictation-body', device: 'device-note-body',
    general: 'Ticket prefix', weaver: 'Reviews every approval before you see it',
    models: 'Overridden here: 2 agents, 0 worker options.', projects: 'projects-body', knowledge: 'Curation',
    approvals: 'YOLO mode', channels: 'channels-body', presentation: 'presentation-body',
    plugins: 'No plugins are configured for this workspace, or the daemon.',
  };
  it.each([
    ...V2_DAEMON_SECTIONS.map((s) => ['daemon', s.key] as const),
    ...V2_WORKSPACE_SECTIONS.map((s) => ['workspace', s.key] as const),
  ])('%s scope, %s section', (scope, key) => {
    state.search = scope === 'workspace' ? { scope: 'acme', section: key } : { section: key };
    render(<V2Settings />);
    const marker = key === 'models' && scope === 'daemon'
      ? /The default for every workspace/
      : expected[key];
    expect(marker).toBeTruthy();
    expect(screen.getByText(marker!)).toBeInTheDocument();
  });
});

describe('the read-only Weaver descriptions', () => {
  it('renders descriptions, not controls', () => {
    state.search = { scope: 'acme', section: 'weaver' };
    render(<V2Settings />);
    expect(screen.getByText('Reviews every approval before you see it')).toBeInTheDocument();
    expect(screen.getByText('Let me override a held card')).toBeInTheDocument();
    expect(screen.getByText('standard')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('the General and Plugins sections', () => {
  it('edits the workspace name', () => {
    state.search = { scope: 'acme', section: 'general' };
    render(<V2Settings />);
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme');
    expect(screen.getByLabelText('Ticket prefix')).toHaveValue('ACME');
  });

  it('lists the loaded plugins read-only', () => {
    state.plugins = [{ id: 'notes', version: '1.2', source: 'workspace', loaded: true, error: null }];
    state.search = { scope: 'acme', section: 'plugins' };
    render(<V2Settings />);
    expect(screen.getByText('notes')).toBeInTheDocument();
    expect(screen.getByText('1.2')).toBeInTheDocument();
  });
});

describe('the Approvals section', () => {
  it('shows an unset approval default as the resolved built-in default, not as an explicit pick', () => {
    state.search = { scope: 'acme', section: 'approvals' };
    render(<V2Settings />);
    const proposal = screen.getByLabelText('Proposal approval') as HTMLSelectElement;
    expect(proposal.value).toBe('human');
    expect(within(proposal).getByRole('option', { name: 'human (default)' })).toBeInTheDocument();
    const delivery = screen.getByLabelText('Delivery mode') as HTMLSelectElement;
    expect(delivery.value).toBe('pr');
    expect(within(delivery).getByRole('option', { name: 'pr (default)' })).toBeInTheDocument();
  });
});

describe('the workspace model overrides', () => {
  it('marks an override, names its diff and counts it', () => {
    state.search = { scope: 'acme', section: 'models' };
    render(<V2Settings />);
    expect(screen.getByText('Overridden here: 2 agents, 0 worker options.')).toBeInTheDocument();
    expect(screen.getByText('Overrides thinking high → max.')).toBeInTheDocument();
    expect(screen.getAllByText('overridden').length).toBeGreaterThanOrEqual(2);
  });

  it('resets a control to the daemon value', () => {
    state.search = { scope: 'acme', section: 'models' };
    render(<V2Settings />);
    const reset = screen.getAllByText('Reset to daemon')[0]!;
    fireEvent.click(reset);
    const write = state.modelWrites.at(-1) as { weaver: { effort?: string }; workers: { runtime: string } };
    expect([write.weaver.effort, write.workers.runtime]).toContain('high');
  });
});
