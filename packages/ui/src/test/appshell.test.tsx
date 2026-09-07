/** The rail: its workspace list, its daemon-update entry, and the shell's own indicators. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus, Upgrade } from '../api/types';

const state = vi.hoisted(() => ({
  update: null as UpdateStatus | null,
  updateError: false,
  upgrade: null as Upgrade | null,
  config: {} as Record<string, unknown>,
  workspaces: [] as Array<Record<string, unknown>>,
  decisions: [] as unknown[],
}));

/** The hotkey bindings the shell registered, so a test can fire one without a real keydown. */
const hotkeys = vi.hoisted(() => ({ current: [] as Array<{ key: string; run: () => void }> }));
/** Where `useGo` was asked to navigate. */
const went = vi.hoisted(() => ({ calls: [] as string[] }));
/** The commands handed to the palette. */
const palette = vi.hoisted(() => ({ commands: [] as Array<{ id: string; label: string; sub?: string }> }));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/w/ws1/chat',
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
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
  useWorkspaceEvents: () => undefined,
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
// Children with their own data hooks; none of them is what this file is about.
vi.mock('../components/CommandPalette', () => ({
  CommandPalette: ({ commands }: { commands: Array<{ id: string; label: string; sub?: string }> }) => {
    palette.commands = commands;
    return null;
  },
}));
vi.mock('../app/BottomBar', () => ({ BottomBar: () => null }));
vi.mock('../lib/queue', () => ({ flushQueue: vi.fn(), useQueueCount: () => 0 }));
vi.mock('../lib/hotkeys', () => ({
  useHotkeys: (keys: Array<{ key: string; run: () => void }>) => { hotkeys.current = keys; },
}));
vi.mock('../api/hooks', () => ({
  useDaemonUpdate: () => ({ data: state.update ?? undefined, isError: state.updateError }),
  useDaemonUpgrade: () => ({ data: { upgrade: state.upgrade, waitingFor: [] }, isError: false }),
  useDecisions: () => ({ data: state.decisions }),
  useProjects: () => ({ data: [] }),
  useTickets: () => ({ data: [] }),
  useTransitionTicket: () => ({ mutate: vi.fn() }),
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' }, config: state.config }, isError: false, error: null, refetch: vi.fn() }),
  useWorkspaces: () => ({ data: state.workspaces }),
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
  hotkeys.current = [];
  went.calls = [];
  palette.commands = [];
  state.config = {};
  localStorage.clear();
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

  it('links straight to the Updates section of Settings', () => {
    state.update = status();
    render(<AppShell />);
    const entry = indicator() as HTMLElement;
    expect(entry).toHaveAttribute('href', '/w/ws1/settings');
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

describe('AppShell — YOLO mode indicator', () => {
  it('shows nothing while the mode is off', () => {
    render(<AppShell />);
    expect(screen.queryByLabelText('YOLO mode is on')).toBeNull();
  });

  it('shows a persistent indicator while the mode is on', () => {
    state.config = { defaults: { yolo: true } };
    render(<AppShell />);
    expect(screen.getByLabelText('YOLO mode is on')).toBeInTheDocument();
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

  it('sends the palette’s Create ticket to the conductor chat', () => {
    render(<AppShell />);
    const create = palette.commands.find((c) => c.id === 'create');
    expect(create?.sub).toBe('in the conductor chat');
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
