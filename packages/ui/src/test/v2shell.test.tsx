/** The V2 shell: the rail's rows, the single highlighted row, scope preservation, collapse, theme. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Upgrade, UpdateStatus } from '../api/types';

const state = vi.hoisted(() => ({
  path: '/w/acme/work',
  workspaces: [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 }],
  projectsByWs: { acme: [{ id: 'p1', slug: 'weave-services-plugin', name: 'Weave Services plugin' }] } as Record<string, Array<{ id: string; slug: string; name: string }>>,
  workersByWs: {
    acme: [
      { id: 'w1', kind: 'worker', ticketId: 't1', status: 'running', createdAt: '2026-09-13T00:00:00Z' },
      { id: 'w2', kind: 'worker', ticketId: 't2', status: 'done', createdAt: '2026-09-13T00:00:00Z' },
    ],
  } as Record<string, Array<{ id: string; kind: string; ticketId: string; status: string; createdAt: string }>>,
  decisionsByWs: { acme: [{ id: 'd1' }, { id: 'd2' }] } as Record<string, Array<{ id: string }>>,
  pluginsByWs: {} as Record<string, Array<{ id: string; version: string | null; name: string | null; source: 'workspace' | 'daemon'; loaded: boolean; error: string | null; hasPage: boolean }>>,
  incidents: [{ resolvedAt: null }, { resolvedAt: '2026-09-01' }] as Array<{ resolvedAt: string | null }>,
  update: null as UpdateStatus | null,
  upgrade: null as Upgrade | null,
  fanIn: [] as string[][],
  barVisible: false,
}));

// The dictation session lives above the shell (VS-450); the shell only reads whether the bar is up.
vi.mock('../v2/DictationSession', () => ({
  useDictationSession: () => (state.barVisible ? { barVisible: true } : null),
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => state.path,
  useParams: () => ({ ws: 'acme' }),
}));

vi.mock('../api/context', () => ({
  // The shell fans in one stream per listed workspace on global pages (VS-366, VS-369); record the calls.
  FanInStreams: ({ ids }: { ids: readonly string[] }) => {
    state.fanIn.push([...ids]);
    return null;
  },
}));

vi.mock('../app/link', () => ({
  A: ({ to, search, children, ...rest }: { to: string; search?: Record<string, unknown>; children?: ReactNode }) => (
    <a href={search ? `${to}?${new URLSearchParams(search as Record<string, string>).toString()}` : to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => () => undefined,
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspaces, isError: false }),
  useWorkspaceProjects: (ids: readonly string[]) =>
    Object.fromEntries(ids.map((id) => [id, { status: 'success', projects: state.projectsByWs[id] ?? [] }])),
  useWorkspacePlugins: (ids: readonly string[]) =>
    Object.fromEntries(ids.map((id) => [id, state.pluginsByWs[id] ?? []])),
  useWorkersMany: (ids: readonly string[]) => ids.map((id) => ({ data: state.workersByWs[id] ?? [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map((id) => (id in state.decisionsByWs ? { data: state.decisionsByWs[id] } : { data: undefined })),
  useIncidents: () => ({ data: { items: state.incidents, total: state.incidents.length } }),
  useMe: () => ({
    data: { operator: { username: 'victor' }, session: { id: 's', kind: 'web' }, totpEnabled: false },
  }),
  useDaemonUpdate: () => ({ data: state.update ?? undefined }),
  useDaemonUpgrade: () => ({ data: { upgrade: state.upgrade, waitingFor: [] } }),
}));

const onTheme = vi.fn();

const { V2Shell } = await import('../v2/V2Shell');
const { V2Page } = await import('../v2/V2Page');

function mountShell(): ReturnType<typeof render> {
  return render(<V2Shell theme="dark" onTheme={onTheme} />);
}

beforeEach(() => {
  state.path = '/w/acme/work';
  state.workspaces = [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 }];
  state.projectsByWs = { acme: [{ id: 'p1', slug: 'weave-services-plugin', name: 'Weave Services plugin' }] };
  state.workersByWs = {
    acme: [
      { id: 'w1', kind: 'worker', ticketId: 't1', status: 'running', createdAt: '2026-09-13T00:00:00Z' },
      { id: 'w2', kind: 'worker', ticketId: 't2', status: 'done', createdAt: '2026-09-13T00:00:00Z' },
    ],
  };
  state.decisionsByWs = { acme: [{ id: 'd1' }, { id: 'd2' }] };
  state.pluginsByWs = {};
  state.update = null;
  state.upgrade = null;
  state.fanIn = [];
  state.barVisible = false;
  onTheme.mockClear();
  localStorage.clear();
});

describe('the V2 rail', () => {
  it('renders the Everywhere group and the workspace sections from the registry', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(screen.getByText('WeaveAI')).toBeInTheDocument();
    expect(within(rail).getByText('Everywhere')).toBeInTheDocument();
    expect(within(rail).getByText('Incidents')).toBeInTheDocument();
    expect(within(rail).getByText('Scheduled')).toBeInTheDocument();
    expect(within(rail).getByText('Work')).toBeInTheDocument();
    expect(within(rail).getByText('Roles')).toBeInTheDocument();
    expect(within(rail).getByText('Knowledge')).toBeInTheDocument();
    expect(within(rail).queryByText('Board')).toBeNull();
  });

  it('highlights exactly one rail row, and it is the header destination', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    const current = within(rail)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Work');
  });

  it('highlights the workspace Needs you shortcut rather than the global row', () => {
    state.path = '/w/acme/needs';
    mountShell();
    const rail = screen.getByRole('complementary');
    const current = within(rail)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/w/acme/needs');
  });
});

describe('the floating dictation bar clearance (VS-450)', () => {
  const routeClass = (view: ReturnType<typeof mountShell>): string => {
    const route = view.container.querySelector('.v2-anim-route');
    return route ? route.className : '';
  };

  it('reserves room for the bar on top of the phone tab bar clearance while it is visible', () => {
    const view = mountShell();
    expect(routeClass(view)).toMatch(/\bpb-14\b/);
    expect(routeClass(view)).not.toMatch(/pb-\[8\.5rem\]/);

    state.barVisible = true;
    view.rerender(<V2Shell theme="dark" onTheme={onTheme} />);
    expect(routeClass(view)).toMatch(/pb-\[8\.5rem\]/);
    expect(routeClass(view)).toMatch(/md:pb-20/);
  });
});

describe('scope preservation', () => {
  it('builds workspace rows against the current workspace and leaves global rows global', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: /Work/ })).toHaveAttribute('href', '/w/acme/work');
    expect(within(rail).getByRole('link', { name: /Roles/ })).toHaveAttribute('href', '/w/acme/roles');
    expect(within(rail).getAllByRole('link', { name: /Needs you/ })[0]).toHaveAttribute('href', '/needs');
  });
});

describe('each workspace group lists its own projects', () => {
  it('links a project by its slug, not its display name, so a name ≠ slug still resolves (VS-424)', () => {
    state.workspaces = [
      { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 },
      { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
    ];
    state.projectsByWs = {
      acme: [{ id: 'p1', slug: 'agent-conductor', name: 'WeaveAI' }],
      beta: [{ id: 'p2', slug: 'fernwood', name: 'Fernwood' }],
    };
    state.decisionsByWs = { acme: [], beta: [] };
    for (const path of ['/w/acme/work', '/w/beta/work']) {
      state.path = path;
      mountShell();
      const rail = screen.getByRole('complementary');
      expect(within(rail).getAllByRole('link', { name: 'WeaveAI' })).toHaveLength(1);
      expect(within(rail).getByRole('link', { name: 'WeaveAI' })).toHaveAttribute('href', '/w/acme/p/agent-conductor');
      expect(within(rail).getAllByRole('link', { name: 'Fernwood' })).toHaveLength(1);
      expect(within(rail).getByRole('link', { name: 'Fernwood' })).toHaveAttribute('href', '/w/beta/p/fernwood');
      cleanup();
    }
  });

  it('highlights the project row when the route names it by slug (VS-424)', () => {
    state.projectsByWs = { acme: [{ id: 'p1', slug: 'agent-conductor', name: 'WeaveAI' }] };
    state.path = '/w/acme/p/agent-conductor';
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: 'WeaveAI' })).toHaveAttribute('aria-current', 'page');
    const current = within(rail).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
  });

  it('gives each project a Roadmap sub-link in the rail and the phone More list, and highlights the project on its roadmap (VS-478)', () => {
    state.projectsByWs = { acme: [{ id: 'p1', slug: 'agent-conductor', name: 'WeaveAI' }] };
    state.path = '/w/acme/p/agent-conductor/roadmap';
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: 'Roadmap' })).toHaveAttribute('href', '/w/acme/p/agent-conductor/roadmap');
    expect(within(rail).getByRole('link', { name: 'WeaveAI' })).toHaveAttribute('aria-current', 'page');

    // The rail is hidden at phone width, so the More list carries the same pair.
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    expect(within(dialog).getByRole('link', { name: 'Roadmap' })).toHaveAttribute('href', '/w/acme/p/agent-conductor/roadmap');
    expect(within(dialog).getByRole('link', { name: 'WeaveAI' })).toHaveAttribute('href', '/w/acme/p/agent-conductor');
  });
});

describe('the V2 rail shows a workspace\'s own loaded plugins with a page (VS-385)', () => {
  it('shows only its own plugin\'s row, in the expanded rail, the collapsed rail and the More list', () => {
    state.workspaces = [
      { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 },
      { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
    ];
    state.decisionsByWs = { acme: [], beta: [] };
    state.pluginsByWs = {
      acme: [{ id: 'notes', version: '0.1.0', name: 'Notes', source: 'workspace', loaded: true, error: null, hasPage: true }],
      beta: [{ id: 'services', version: '0.1.0', name: null, source: 'workspace', loaded: true, error: null, hasPage: true }],
    };

    // Every workspace group is expanded by default (the same as for projects), so both plugin
    // rows are present — each correctly scoped to its own workspace's href — and only the one
    // matching the current path is highlighted.
    state.path = '/w/acme/plugins/notes';
    mountShell();
    const rail = screen.getByRole('complementary');
    const notesLink = within(rail).getByRole('link', { name: 'Notes' });
    expect(notesLink).toHaveAttribute('href', '/w/acme/plugins/notes');
    expect(notesLink).toHaveAttribute('aria-current', 'page');
    // "services" declares no name, so its row falls back to its id (VS-385 Decision 2).
    const servicesLink = within(rail).getByRole('link', { name: 'services' });
    expect(servicesLink).toHaveAttribute('href', '/w/beta/plugins/services');
    expect(servicesLink).not.toHaveAttribute('aria-current');
    cleanup();

    // Collapsed rail (single active workspace only): the active workspace's own plugin, icon-only,
    // reachable by its title/aria-label.
    localStorage.setItem('weave.v2.rail', 'collapsed');
    mountShell();
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('href', '/w/acme/plugins/notes');
    expect(screen.queryByRole('link', { name: 'services' })).not.toBeInTheDocument();
    localStorage.clear();
    cleanup();

    // The phone More sheet's "Workspace" group is scoped the same way: only the active workspace's
    // own plugin, not the other workspace's.
    mountShell();
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    expect(within(dialog).getByRole('link', { name: 'Notes' })).toHaveAttribute('href', '/w/acme/plugins/notes');
    expect(within(dialog).queryByRole('link', { name: 'services' })).not.toBeInTheDocument();
  });

  it('shows no plugin row for a workspace with no loaded plugin with a page', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).queryByRole('link', { name: 'notes' })).not.toBeInTheDocument();
  });
});

describe('the rail counts', () => {
  it('renders the Live and Needs you counts from seeded workers and decisions, with no interaction', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: /Live/ })).toHaveTextContent('1');
    const needs = within(rail).getAllByRole('link', { name: /Needs you/ });
    expect(needs.find((a) => a.getAttribute('href') === '/needs')).toHaveTextContent('2');
    expect(needs.find((a) => a.getAttribute('href') === '/w/acme/needs')).toHaveTextContent('2');
  });

  it('counts only workers that read as working, not those between turns (VS-415)', () => {
    state.workersByWs = {
      acme: [
        { id: 'w1', kind: 'worker', ticketId: 't1', status: 'running', createdAt: '2026-09-13T00:00:00Z' },
        { id: 'w2', kind: 'worker', ticketId: 't2', status: 'active', createdAt: '2026-09-13T00:00:00Z' },
        { id: 'w3', kind: 'worker', ticketId: 't3', status: 'provisioning', createdAt: '2026-09-13T00:00:00Z' },
        { id: 'w4', kind: 'worker', ticketId: 't4', status: 'done', createdAt: '2026-09-13T00:00:00Z' },
      ],
    };
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: /Live/ })).toHaveTextContent('1');
  });

  it('counts only the cards captain can act on, globally and per workspace (VS-411)', () => {
    // The daemon's own `needsYou` (9) stands in only until the decisions load; with data in hand the
    // badge drops a plan/merge/action card the weaver has not reviewed, and keeps looked/concerns.
    state.workspaces = [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 9 }];
    state.decisionsByWs = {
      acme: [
        { id: 'd1', kind: 'plan_approval', weaverReviewStatus: 'unseen' },
        { id: 'd2', kind: 'merge_approval', weaverReviewStatus: 'looked' },
        { id: 'd3', kind: 'action_approval', weaverReviewStatus: 'concerns' },
        { id: 'd4', kind: 'question', weaverReviewStatus: 'unseen' },
      ],
    } as unknown as Record<string, Array<{ id: string }>>;
    mountShell();
    const rail = screen.getByRole('complementary');
    const needs = within(rail).getAllByRole('link', { name: /Needs you/ });
    expect(needs.find((a) => a.getAttribute('href') === '/needs')).toHaveTextContent('3');
    expect(needs.find((a) => a.getAttribute('href') === '/w/acme/needs')).toHaveTextContent('3');
  });
});

describe('the rail carries the kept V1 screens', () => {
  it('shows Chats in Everywhere and Usage and Changelog under the workspace', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: 'Chats' })).toHaveAttribute('href', '/chats');
    expect(within(rail).getByRole('link', { name: 'Usage' })).toHaveAttribute('href', '/w/acme/usage');
    expect(within(rail).getByRole('link', { name: 'Changelog' })).toHaveAttribute('href', '/w/acme/changelog');
  });

  it('shows Usage and Changelog under every workspace group, each scoped to its own workspace', () => {
    state.workspaces = [
      { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 },
      { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
    ];
    state.projectsByWs = { acme: [], beta: [] };
    state.decisionsByWs = { acme: [], beta: [] };
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getAllByRole('link', { name: 'Usage' }).map((a) => a.getAttribute('href'))).toEqual([
      '/w/acme/usage',
      '/w/beta/usage',
    ]);
    expect(within(rail).getAllByRole('link', { name: 'Changelog' }).map((a) => a.getAttribute('href'))).toEqual([
      '/w/acme/changelog',
      '/w/beta/changelog',
    ]);
  });

  it('highlights exactly the kept row on each kept route', () => {
    for (const [path, href] of [
      ['/chats', '/chats'],
      ['/w/acme/usage', '/w/acme/usage'],
      ['/w/acme/changelog', '/w/acme/changelog'],
    ] as const) {
      state.path = path;
      cleanup();
      mountShell();
      const rail = screen.getByRole('complementary');
      const current = within(rail).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAttribute('href', href);
    }
  });

  it('keeps them as marks in the collapsed rail', () => {
    localStorage.setItem('weave.v2.rail', 'collapsed');
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: 'Chats' })).toHaveAttribute('href', '/chats');
    expect(within(rail).getByRole('link', { name: 'Usage' })).toHaveAttribute('href', '/w/acme/usage');
    expect(within(rail).getByRole('link', { name: 'Changelog' })).toHaveAttribute('href', '/w/acme/changelog');
  });
});

describe('the collapsed rail is remembered', () => {
  it('collapses, writes the choice, and restores it on the next mount', () => {
    const { unmount } = mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the sidebar' }));
    expect(localStorage.getItem('weave.v2.rail')).toBe('collapsed');
    expect(screen.getByRole('button', { name: 'Expand the sidebar' })).toBeInTheDocument();
    unmount();
    cleanup();
    mountShell();
    expect(screen.getByRole('button', { name: 'Expand the sidebar' })).toBeInTheDocument();
    expect(screen.queryByText('WeaveAI')).toBeNull();
  });
});

describe('the in-app theme switch', () => {
  it('reports the chosen theme', () => {
    mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(onTheme).toHaveBeenCalledWith('light');
  });
});

describe('the phone tab bar and More', () => {
  it('shows the five tabs', () => {
    mountShell();
    const nav = screen.getByRole('navigation');
    for (const label of ['Chat', 'Needs you', 'Work', 'Live', 'More']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it('opens More with the grouped destinations the rail leaves out', () => {
    mountShell();
    fireEvent.click(within(screen.getByRole('navigation')).getByText('More'));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    expect(within(dialog).getByText('Everywhere')).toBeInTheDocument();
    expect(within(dialog).getByText('Usage')).toBeInTheDocument();
    expect(within(dialog).getByText('Open V1')).toBeInTheDocument();
  });

  it('offers the knowledge graph and explorer only as Knowledge tabs, never in More (VS-371)', () => {
    mountShell();
    // The phone tab bar's More opens the grouped destination list.
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    expect(within(dialog).queryByText('Knowledge graph')).toBeNull();
    expect(within(dialog).queryByText('Knowledge explorer')).toBeNull();
    // The kept screens that have no rail row are still reached here.
    expect(within(dialog).getByText('Chats')).toBeInTheDocument();
    expect(within(dialog).getByText('Changelog')).toBeInTheDocument();
  });

  it('keeps More on the phone tab bar and drops it from the desktop rail (VS-421)', () => {
    mountShell();
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'More' })).toBeInTheDocument();
    const rail = screen.getByRole('complementary');
    expect(within(rail).queryByText('More…')).toBeNull();
    expect(within(rail).queryByRole('button', { name: 'More' })).toBeNull();
    cleanup();
    // The collapsed rail has no More row either.
    localStorage.setItem('weave.v2.rail', 'collapsed');
    mountShell();
    const collapsed = screen.getByRole('complementary');
    expect(within(collapsed).queryByText('More…')).toBeNull();
    expect(within(collapsed).queryByRole('button', { name: 'More' })).toBeNull();
  });
});

const UPDATE_STATUS: UpdateStatus = {
  configured: true,
  running: { version: 'aaaaaaaaaa', path: '/rel/20260101-120000-aaaaaaaaaa', sha: 'a'.repeat(40) },
  source: '/src/agent-conductor',
  ref: 'main',
  targetSha: 'b'.repeat(40),
  updateAvailable: true,
  checkedAt: '2026-09-14T10:00:00.000Z',
  error: null,
};

const UPGRADE: Upgrade = {
  id: 'u1', state: 'building', source: '/src/agent-conductor', ref: 'main', targetSha: 'b'.repeat(40),
  fromRelease: null, toRelease: null, toSha: null, requestedBy: 'op1',
  requestedAt: '2026-09-14T10:00:00.000Z', startedAt: null, finishedAt: null, reason: null,
  message: null, log: [], backups: [], cameBackVersion: null,
};

describe('the rail update entry (VS-421)', () => {
  it('renders the entry when an update is available, linking to Settings → Updates', () => {
    state.update = UPDATE_STATUS;
    mountShell();
    const entry = within(screen.getByRole('complementary')).getByLabelText('Daemon update available');
    expect(entry).toHaveTextContent('Update available');
    expect(entry).toHaveTextContent('main · bbbbbbbbbb');
    expect(entry).toHaveTextContent('Open Updates');
    expect(entry).toHaveAttribute('href', '/settings?section=updates');
  });

  it('says the daemon is upgrading while one is in flight, ahead of an available update', () => {
    state.update = UPDATE_STATUS;
    state.upgrade = { ...UPGRADE, state: 'switching' };
    mountShell();
    const entry = within(screen.getByRole('complementary')).getByLabelText('Daemon upgrade in progress');
    expect(entry).toHaveTextContent('Upgrading the daemon');
    expect(entry).toHaveTextContent('Backing up and switching');
  });

  it('shows nothing when the daemon is up to date', () => {
    state.update = { ...UPDATE_STATUS, updateAvailable: false };
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).queryByLabelText('Daemon update available')).toBeNull();
    expect(within(rail).queryByText('Open Updates')).toBeNull();
  });

  it('carries a compact form of the entry in the collapsed rail', () => {
    state.update = UPDATE_STATUS;
    localStorage.setItem('weave.v2.rail', 'collapsed');
    mountShell();
    const entry = within(screen.getByRole('complementary')).getByLabelText('Daemon update available');
    expect(entry).toHaveAttribute('href', '/settings?section=updates');
    expect(entry.querySelector('svg[data-v2-glyph="update"]')).not.toBeNull();
  });

  it('carries the entry in the phone More sheet', () => {
    state.update = UPDATE_STATUS;
    mountShell();
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'More' }));
    const entry = within(screen.getByRole('dialog', { name: 'More' })).getByLabelText('Daemon update available');
    expect(entry).toHaveTextContent('Open Updates');
    expect(entry).toHaveAttribute('href', '/settings?section=updates');
  });
});

describe('live streams on global pages (VS-366, VS-369)', () => {
  it('opens exactly one stream per listed workspace on a global page', () => {
    state.path = '/needs';
    state.workspaces = [
      { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 },
      { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
    ];
    mountShell();
    // One fan-in mount carrying one id per workspace; a second mount would duplicate every stream.
    expect(state.fanIn).toEqual([['acme', 'beta']]);
  });

  it('does not fan in on a workspace page (V2Workspace owns the stream)', () => {
    mountShell();
    expect(state.fanIn).toEqual([]);
  });

  it('does not fan in on Global Chats, which opens one per pane', () => {
    state.path = '/chats';
    mountShell();
    expect(state.fanIn).toEqual([]);
  });
});

describe('the V2 page header', () => {
  it('names the destination, its root and its one-source counts', () => {
    render(<V2Page title="Work" />);
    expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('2 need you')).toBeInTheDocument();
  });

  it('shows the workspace’s own working count, not the daemon-wide one (VS-415)', () => {
    state.workspaces = [
      { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 0 },
      { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
    ];
    state.workersByWs = {
      acme: [{ id: 'w1', kind: 'worker', ticketId: 't1', status: 'running', createdAt: '2026-09-13T00:00:00Z' }],
      beta: [
        { id: 'w2', kind: 'worker', ticketId: 't2', status: 'running', createdAt: '2026-09-13T00:00:00Z' },
        { id: 'w3', kind: 'worker', ticketId: 't3', status: 'active', createdAt: '2026-09-13T00:00:00Z' },
      ],
    };
    state.path = '/w/beta/work';
    render(<V2Page title="Work" />);
    // Acme and Beta each have a working worker: the pill on Beta's page must read Beta's one, not
    // the daemon-wide two.
    expect(screen.getByText('1 running')).toBeInTheDocument();
  });

  it('renders a screen-supplied action in the header without changing the label or counts', () => {
    render(<V2Page title="Usage" actions={<button type="button">week · day</button>} />);
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'week · day' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('2 need you')).toBeInTheDocument();
  });

  it('renders no controls when a screen supplies no actions', () => {
    render(<V2Page title="Work" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('scrolls its own body by default, and hands the one scroll region to a fill screen', () => {
    const { container, rerender } = render(<V2Page title="Work">body</V2Page>);
    const body = container.querySelector('[data-v2-page-body]') as HTMLElement;
    expect(body.getAttribute('data-v2-page-body')).toBe('scroll');
    expect(body.className).toContain('overflow-y-auto');

    rerender(<V2Page title="Work" scroll={false}>body</V2Page>);
    const fill = container.querySelector('[data-v2-page-body]') as HTMLElement;
    expect(fill.getAttribute('data-v2-page-body')).toBe('fill');
    expect(fill.className).not.toContain('overflow-y-auto');
    expect(fill.className).toContain('overflow-hidden');
  });
});

describe('every V2 nav surface renders the Lucide icon set (VS-420)', () => {
  const RAIL_LABELS = ['Chat', 'Chats', 'Work', 'Roles', 'Knowledge', 'Live', 'Incidents', 'Scheduled', 'Settings'];

  it('carries a mapped icon on each expanded-rail destination', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    for (const label of RAIL_LABELS) {
      // A counted row's accessible name carries the count too ("Live 1"), so match on the prefix.
      const glyph = within(rail).getByRole('link', { name: new RegExp(`^${label}\\b`) }).querySelector('svg[data-v2-glyph]');
      expect(glyph, `${label} must carry a glyph`).not.toBeNull();
      expect(glyph!.classList.contains('lucide')).toBe(true);
    }
  });

  it('carries a mapped icon on each collapsed-rail row', () => {
    localStorage.setItem('weave.v2.rail', 'collapsed');
    mountShell();
    const rail = screen.getByRole('complementary');
    for (const label of RAIL_LABELS) {
      expect(within(rail).getByRole('link', { name: label }).querySelector('svg[data-v2-glyph]')).not.toBeNull();
    }
  });

  it('carries a mapped icon on each phone tab and the More control', () => {
    mountShell();
    const nav = screen.getByRole('navigation');
    for (const label of ['Chat', 'Needs you', 'Work', 'Live']) {
      expect(within(nav).getByRole('link', { name: label }).querySelector('svg[data-v2-glyph]')).not.toBeNull();
    }
    // More is a menu, so it gets its own mark rather than the Settings glyph (VS-420).
    expect(within(nav).getByRole('button', { name: 'More' }).querySelector('svg[data-v2-glyph="more"]')).not.toBeNull();
  });
});
