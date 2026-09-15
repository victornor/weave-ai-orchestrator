/** The rail: its workspace list, its daemon-update entry, and the shell's own indicators. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus, Upgrade } from '../api/types';

const state = vi.hoisted(() => ({
  update: null as UpdateStatus | null,
  updateError: false,
  upgrade: null as Upgrade | null,
  config: {} as Record<string, unknown>,
  workspaces: [] as Array<Record<string, unknown>>,
  decisions: [] as unknown[],
  /** What the mocked `useWorkspaceProjects` answers for each workspace id, keyed by id. */
  projectsByWs: {} as Record<string, { status: 'pending' | 'error' | 'success'; projects: Array<Record<string, unknown>> }>,
  path: '/w/ws1/chat',
  daemonWorkerOptions: null as Array<{ id: string; description: string; runtime: string | null; model: string | null }> | null,
  hostTools: [] as Array<{ id: string; available: boolean; version: string | null; path: string | null; need: 'required' | 'recommended'; purpose: string }>,
}));

/** Every `ids` array the mocked `FanInStreams` was rendered with, in render order (VS-199). */
const fanIn = vi.hoisted(() => ({ calls: [] as string[][] }));

/** Every `ids` array the mocked `useWorkspaceProjects` was called with, in render order. */
const projectRequests = vi.hoisted(() => ({ calls: [] as string[][] }));
/** What the mocked `CommandPalette` was last handed for the project scope. */
const paletteScope = vi.hoisted(() => ({ scope: null as string | null, onScopeCycle: (() => {}) as () => void }));
/** What the mocked `MoreSheet` was last handed. */
const moreSheet = vi.hoisted(() => ({ projects: [] as Array<Record<string, unknown>> }));

/** The hotkey bindings the shell registered, so a test can fire one without a real keydown. */
const hotkeys = vi.hoisted(() => ({ current: [] as Array<{ key: string; run: () => void }> }));
/** Where `useGo` was asked to navigate. */
const went = vi.hoisted(() => ({ calls: [] as string[] }));
/** The commands handed to the palette. */
const palette = vi.hoisted(() => ({ commands: [] as Array<{ id: string; label: string; sub?: string }> }));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => state.path,
}));
// The rail entry is a link with a search target, so the stand-in has to keep both.
vi.mock('../app/link', () => ({
  A: ({ to, params, search, children, ...rest }: { to: string; params?: Record<string, string>; search?: Record<string, unknown>; children: React.ReactNode }) => (
    <a
      href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)}
      data-search={search ? JSON.stringify(search) : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
  useGo: () => (to: string, opts?: { params?: Record<string, string> }) => {
    went.calls.push(Object.entries(opts?.params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to));
  },
}));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useOptionalWorkspace: () => ({ ws: 'ws1', connection: { state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }, stream: null }),
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
  useWorkspaceEvents: () => undefined,
  FanInStreams: ({ ids }: { ids: string[] }) => {
    fanIn.calls.push(ids);
    return null;
  },
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
// Children with their own data hooks; none of them is what this file is about.
vi.mock('../components/CommandPalette', () => ({
  CommandPalette: ({ commands, scope, onScopeCycle }: { commands: Array<{ id: string; label: string; sub?: string }>; scope: string | null; onScopeCycle: () => void }) => {
    palette.commands = commands;
    paletteScope.scope = scope;
    paletteScope.onScopeCycle = onScopeCycle;
    return null;
  },
}));
vi.mock('../app/MoreSheet', () => ({
  MoreSheet: ({ projects }: { projects: Array<Record<string, unknown>> }) => {
    moreSheet.projects = projects;
    return null;
  },
}));
// Stood in for so the shell's half of the hide/show wiring is what this file reads: the bar itself
// is `bottombar.test.tsx`.
vi.mock('../app/BottomBar', () => ({
  BottomBar: ({ hidden, onToggleHidden }: { hidden?: boolean; onToggleHidden: (h: boolean) => void }) => (
    <button type="button" aria-label="bar stand-in" aria-pressed={hidden ?? false} onClick={() => onToggleHidden(!(hidden ?? false))} />
  ),
}));
vi.mock('../lib/queue', () => ({ flushQueue: vi.fn(), useQueueCount: () => 0 }));
vi.mock('../lib/hotkeys', () => ({
  useHotkeys: (keys: Array<{ key: string; run: () => void }>) => { hotkeys.current = keys; },
}));
vi.mock('../api/hooks', () => ({
  useDaemonUpdate: () => ({ data: state.update ?? undefined, isError: state.updateError }),
  useDaemonUpgrade: () => ({ data: { upgrade: state.upgrade, waitingFor: [] }, isError: false }),
  useDecisions: () => ({ data: state.decisions }),
  useWorkspaceProjects: (ids: string[]) => {
    projectRequests.calls.push(ids);
    const map: Record<string, { status: 'pending' | 'error' | 'success'; projects: Array<Record<string, unknown>> }> = {};
    for (const id of ids) map[id] = state.projectsByWs[id] ?? { status: 'success', projects: [] };
    return map;
  },
  useTickets: () => ({ data: [] }),
  useTransitionTicket: () => ({ mutate: vi.fn() }),
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' }, config: state.config }, isError: false, error: null, refetch: vi.fn() }),
  useWorkspaces: () => ({ data: state.workspaces }),
  useDaemonModels: () => ({ data: { weaver: null, workers: null, workerOptions: state.daemonWorkerOptions }, isLoading: false }),
  useDaemonHostTools: () => ({ data: { paths: [], tools: state.hostTools }, isLoading: false }),
}));

const { AppShell } = await import('../app/AppShell');

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  configured: true,
  running: { version: '1.0.0', path: '/rel/a', sha: 'a'.repeat(40) },
  source: '/src', ref: 'main', targetSha: 'b'.repeat(40),
  updateAvailable: true, checkedAt: '2026-09-05T10:00:00.000Z', error: null, ...over,
});

const record = (over: Partial<Upgrade> = {}): Upgrade => ({
  id: 'u1', state: 'queued', source: '/src', ref: 'main', targetSha: 'b'.repeat(40),
  fromRelease: '/rel/a', toRelease: null, toSha: null, requestedBy: 'op1',
  requestedAt: '2026-09-05T10:00:00.000Z', startedAt: null, finishedAt: null, reason: null, message: null,
  log: [], backups: [], cameBackVersion: null, ...over,
});

const indicator = (): HTMLElement | null => screen.queryByLabelText('Daemon update available');
const upgrading = (): HTMLElement | null => screen.queryByLabelText('Daemon upgrade in progress');

const listItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ws1', name: 'Acme', ticketPrefix: 'ACME', root: '/tmp/ws1', projects: [], needsYou: 0, ...over,
});

beforeEach(() => {
  state.update = null;
  state.updateError = false;
  state.upgrade = null;
  state.workspaces = [];
  state.decisions = [];
  state.path = '/w/ws1/chat';
  hotkeys.current = [];
  went.calls = [];
  palette.commands = [];
  state.config = {};
  state.projectsByWs = {};
  projectRequests.calls = [];
  paletteScope.scope = null;
  moreSheet.projects = [];
  fanIn.calls = [];
  localStorage.clear();
  state.daemonWorkerOptions = null;
  state.hostTools = [];
});
describe('FanInStreams gating on global pages', () => {
  it('is not rendered on /chats, which manages its own per-pane subscriptions (VS-199)', () => {
    state.path = '/chats';
    state.workspaces = [listItem({ id: 'ws1' }), listItem({ id: 'ws2', name: 'Beta' })];
    render(<AppShell />);
    expect(fanIn.calls).toHaveLength(0);
  });

  it('is still rendered on the other global pages, the daemon settings included (VS-230)', () => {
    for (const path of ['/needs', '/settings', '/scheduled']) {
      fanIn.calls = [];
      state.path = path;
      state.workspaces = [listItem({ id: 'ws1' }), listItem({ id: 'ws2', name: 'Beta' })];
      cleanup();
      render(<AppShell />);
      expect(fanIn.calls).toEqual([['ws1', 'ws2']]);
    }
  });
});

describe('the rail update entry', () => {
  it('is shown when the daemon reports an update', () => {
    state.update = status();
    render(<AppShell />);
    expect(indicator()).toBeInTheDocument();
  });

  it('names the update and the target it would move to', () => {
    state.update = status();
    render(<AppShell />);
    const entry = indicator() as HTMLElement;
    expect(entry).toHaveTextContent('Update available');
    expect(entry).toHaveTextContent('main');
    expect(entry).toHaveTextContent('b'.repeat(10));
  });

  it('links straight to the Updates section of the daemon settings', () => {
    state.update = status();
    render(<AppShell />);
    const entry = indicator() as HTMLElement;
    expect(entry).toHaveAttribute('href', '/settings');
    expect(JSON.parse(entry.getAttribute('data-search') ?? '{}')).toEqual({ section: 'updates' });
  });

  it('shows the upgrade instead of the update once one is in flight, and only that', () => {
    state.update = status();
    state.upgrade = record({ state: 'building' });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
    expect(upgrading()).toHaveTextContent('Building the new release');
  });

  it('is gone once the upgrade reached a terminal state and no update is left', () => {
    state.update = status({ updateAvailable: false });
    state.upgrade = record({ state: 'completed' });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
    expect(upgrading()).not.toBeInTheDocument();
  });

  it('is not shown when the daemon is up to date', () => {
    state.update = status({ updateAvailable: false });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
  });

  it('is not shown, and nothing is reported, when checking is not configured', () => {
    state.update = status({ configured: false, source: null, ref: null, targetSha: null, updateAvailable: false, checkedAt: null });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it('is not shown when the check itself failed', () => {
    state.update = status({ error: 'Could not resolve hostname' });
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
  });

  it('is not shown before the first check has answered', () => {
    render(<AppShell />);
    expect(indicator()).not.toBeInTheDocument();
  });
});

describe('AppShell — no workspace-wide YOLO indicator (VS-382)', () => {
  it('shows no workspace indicator while the mode is off', () => {
    render(<AppShell />);
    expect(screen.queryByLabelText('YOLO mode is on')).toBeNull();
  });

  it('shows no workspace-wide indicator even when a config still carries the deprecated key', () => {
    state.config = { defaults: { yolo: true } };
    render(<AppShell />);
    expect(screen.queryByLabelText('YOLO mode is on')).toBeNull();
  });
});

describe('the rail workspace list', () => {
  it('has no workspace switcher menu left', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', ticketPrefix: 'BET' })];
    render(<AppShell />);
    expect(screen.queryByRole('button', { expanded: false, name: /Acme/ })).toBeNull();
    expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it('shows the active workspace from the route before the list has answered', () => {
    render(<AppShell />);
    expect(screen.getByLabelText('Acme sections')).toBeInTheDocument();
  });

  it('links straight to another workspace’s board', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', ticketPrefix: 'BET' })];
    render(<AppShell />);
    fireEvent.click(screen.getByText('Beta'));
    const beta = screen.getByLabelText('Beta sections');
    expect(within(beta).getByText('Board').closest('a')).toHaveAttribute('href', '/w/beta/board');
  });

  it('keeps New workspace reachable without opening a menu', () => {
    render(<AppShell />);
    fireEvent.click(screen.getByText('New workspace'));
    expect(went.calls).toContain('/onboarding');
  });
});

describe('the rail\'s per-workspace projects (VS-128)', () => {
  it('requests and shows a non-active workspace\'s projects once its group is expanded', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta', ticketPrefix: 'BET' })];
    state.projectsByWs = { beta: { status: 'success', projects: [{ id: 'p1', slug: 'api' }] } };
    render(<AppShell />);
    fireEvent.click(screen.getByText('Beta'));
    expect(projectRequests.calls.at(-1)).toContain('beta');
    const link = within(screen.getByLabelText('Beta projects')).getByText('api').closest('a');
    expect(link?.getAttribute('href')).toBe('/w/beta/p/api');
  });

  it('never requests projects for a workspace whose group has not been expanded', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' }), listItem({ id: 'gamma', name: 'Gamma' })];
    render(<AppShell />);
    fireEvent.click(screen.getByText('Beta'));
    expect(projectRequests.calls.at(-1)).not.toContain('gamma');
  });

  it('always requests the active workspace\'s projects, expanded or not', () => {
    render(<AppShell />);
    expect(projectRequests.calls.at(-1)).toContain('ws1');
  });

  it('hands the active workspace\'s projects to MoreSheet', () => {
    state.projectsByWs = { ws1: { status: 'success', projects: [{ id: 'p1', slug: 'web' }] } };
    render(<AppShell />);
    expect(moreSheet.projects).toEqual([{ id: 'p1', slug: 'web' }]);
  });

  it('cycles the command palette scope through the active workspace\'s own projects', () => {
    state.projectsByWs = { ws1: { status: 'success', projects: [{ id: 'p1', slug: 'web' }, { id: 'p2', slug: 'api' }] } };
    render(<AppShell />);
    expect(paletteScope.scope).toBeNull();
    act(() => paletteScope.onScopeCycle());
    expect(paletteScope.scope).toBe('web');
    act(() => paletteScope.onScopeCycle());
    expect(paletteScope.scope).toBe('api');
    act(() => paletteScope.onScopeCycle());
    expect(paletteScope.scope).toBeNull();
  });
});

describe('expansion memory', () => {
  it('remembers what was expanded and restores it on a remount', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' }), listItem({ id: 'gamma', name: 'Gamma' })];
    const first = render(<AppShell />);
    fireEvent.click(screen.getByText('Beta'));
    fireEvent.click(screen.getByText('Gamma'));
    expect(JSON.parse(localStorage.getItem('conductor.ws.expanded') ?? '[]')).toEqual(['beta', 'gamma']);

    first.unmount();
    render(<AppShell />);
    expect(screen.getByLabelText('Beta sections')).toBeInTheDocument();
    expect(screen.getByLabelText('Gamma sections')).toBeInTheDocument();
  });

  it('expands only the active workspace when nothing was remembered', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' })];
    render(<AppShell />);
    expect(screen.getByLabelText('Acme sections')).toBeInTheDocument();
    expect(screen.queryByLabelText('Beta sections')).not.toBeInTheDocument();
  });

  it('ignores a remembered workspace the daemon no longer reports, and leaves it stored', () => {
    localStorage.setItem('conductor.ws.expanded', JSON.stringify(['retired', 'beta']));
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' })];
    render(<AppShell />);
    expect(screen.queryByText('retired')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Beta sections')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('conductor.ws.expanded') ?? '[]')).toContain('retired');
  });
});

describe('asking for work goes through the chat', () => {
  it('has no Start Work control left in the rail', () => {
    render(<AppShell />);
    expect(screen.queryByText(/start work/i)).toBeNull();
  });

  it('has no shortcut left that would open one', () => {
    render(<AppShell />);
    expect(hotkeys.current.find((k) => k.key === 'Space')).toBeUndefined();
  });

  it('sends the palette’s Create ticket to the weave chat', () => {
    render(<AppShell />);
    const create = palette.commands.find((c) => c.id === 'create');
    expect(create?.sub).toBe('in the weave chat');
    (create as unknown as { run: () => void }).run();
    expect(went.calls).toContain('/w/ws1/chat');
  });
});

describe('shortcuts and the palette with several workspaces', () => {
  it('sends a section shortcut to the active workspace', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' })];
    render(<AppShell />);
    fireEvent.click(screen.getByText('Beta'));
    hotkeys.current.find((k) => k.key === '3')?.run();
    expect(went.calls).toContain('/w/ws1/board');
    expect(went.calls).not.toContain('/w/beta/board');
  });

  it('still offers Switch workspace for the other workspaces', () => {
    state.workspaces = [listItem(), listItem({ id: 'beta', name: 'Beta' })];
    render(<AppShell />);
    const switches = palette.commands.filter((c) => c.label === 'Switch workspace');
    expect(switches).toHaveLength(1);
    expect(switches[0]?.sub).toBe('Beta');
  });
});

describe('the Needs-you badge', () => {
  it('shows the live count on the active workspace and the listed count on the others', () => {
    state.decisions = [{}, {}];
    state.workspaces = [listItem({ needsYou: 9 }), listItem({ id: 'beta', name: 'Beta', needsYou: 4 })];
    render(<AppShell />);
    expect(screen.getByLabelText('2 waiting for you')).toBeInTheDocument();
    expect(screen.getByLabelText('4 waiting for you')).toBeInTheDocument();
    expect(screen.queryByLabelText('9 waiting for you')).not.toBeInTheDocument();
  });
});

describe('the phone tab bar', () => {
  const shell = (c: HTMLElement): HTMLElement => c.querySelector('.ac-app') as HTMLElement;

  it('reserves the bar its space until the human folds it away', () => {
    const { container } = render(<AppShell />);
    expect(shell(container).dataset.bar).toBe('shown');
    // One class, one variable: the content above the bar reads whatever `data-bar` leaves it.
    expect(container.querySelector('main')?.className).toContain('ac-bar-pad');

    fireEvent.click(screen.getByLabelText('bar stand-in'));
    expect(shell(container).dataset.bar).toBe('hidden');
    expect(container.querySelector('main')?.className).toContain('ac-bar-pad');
  });

  it('remembers the choice for this device', () => {
    const { container, unmount } = render(<AppShell />);
    fireEvent.click(screen.getByLabelText('bar stand-in'));
    expect(shell(container).dataset.bar).toBe('hidden');
    unmount();

    const again = render(<AppShell />);
    expect(shell(again.container).dataset.bar).toBe('hidden');
    fireEvent.click(screen.getByLabelText('bar stand-in'));
    expect(shell(again.container).dataset.bar).toBe('shown');
  });

  it('opens with the bar showing on a device that never hid it', () => {
    const { container } = render(<AppShell />);
    expect(shell(container).dataset.bar).toBe('shown');
    expect(screen.getByLabelText('bar stand-in')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('AppShell — unconfigured worker-tier banner (VS-236)', () => {
  const banner = (): HTMLElement | null => screen.queryByRole('status', { name: 'Worker adapters are not chosen' });
  const unconfigured = [
    { id: 'quick', description: 'Fastest.', runtime: null, model: null },
    { id: 'standard', description: 'Default.', runtime: 'claude', model: null },
  ];

  it('shows on a workspace route while any daemon option has no runtime', () => {
    state.daemonWorkerOptions = unconfigured;
    render(<AppShell />);
    expect(banner()).toBeInTheDocument();
    expect(banner()).toHaveTextContent('Worker adapters are not chosen yet');
    expect(banner()).toHaveTextContent('daemon Settings → Models');
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    const link = within(banner() as HTMLElement).getByRole('link', { name: 'Open Models' });
    expect(link).toHaveAttribute('href', '/settings');
    expect(JSON.parse(link.getAttribute('data-search') ?? '{}')).toEqual({ section: 'daemon-models' });
  });

  it('shows on /settings the same way', () => {
    state.path = '/settings';
    state.daemonWorkerOptions = unconfigured;
    render(<AppShell />);
    expect(banner()).toBeInTheDocument();
  });

  it('is absent when every option is configured', () => {
    state.daemonWorkerOptions = [
      { id: 'quick', description: 'Fastest.', runtime: 'claude', model: null },
    ];
    render(<AppShell />);
    expect(banner()).not.toBeInTheDocument();
  });

  it('is absent when the daemon overlay is empty', () => {
    state.daemonWorkerOptions = null;
    render(<AppShell />);
    expect(banner()).not.toBeInTheDocument();
  });
});

describe('AppShell — unavailable host tool banner (VS-318)', () => {
  const banner = (): HTMLElement | null => screen.queryByRole('status', { name: 'Host tools are missing' });
  const tool = (over: Partial<{ id: string; available: boolean; version: string | null; path: string | null; need: 'required' | 'recommended'; purpose: string }>) => ({
    id: 'gh', available: false, version: null, path: null, need: 'recommended' as const, purpose: 'pull-request delivery', ...over,
  });

  it('shows an unavailable required/recommended tool without a health probe', () => {
    state.hostTools = [tool({}), tool({ id: 'openspec', available: true, version: '1.12.0', path: '/usr/bin/openspec' })];
    render(<AppShell />);
    expect(banner()).toBeInTheDocument();
    expect(banner()).toHaveTextContent('gh');
    const link = within(banner() as HTMLElement).getByRole('link', { name: 'Open Host tools' });
    expect(JSON.parse(link.getAttribute('data-search') ?? '{}')).toEqual({ section: 'host-tools' });
  });

  it('clears when every tool is available', () => {
    state.hostTools = [tool({ available: true, version: '2.100.0' })];
    render(<AppShell />);
    expect(banner()).not.toBeInTheDocument();
  });
});
