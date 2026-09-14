/** The V2 shell: the rail's rows, the single highlighted row, scope preservation, collapse, theme. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  path: '/v2/w/acme/work',
  workspaces: [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 }],
  projectsByWs: { acme: [{ id: 'p1', slug: 'web', name: 'web' }] } as Record<string, Array<{ id: string; slug: string; name: string }>>,
  workersByWs: {
    acme: [
      { id: 'w1', kind: 'worker', ticketId: 't1', status: 'running', createdAt: '2026-09-13T00:00:00Z' },
      { id: 'w2', kind: 'worker', ticketId: 't2', status: 'done', createdAt: '2026-09-13T00:00:00Z' },
    ],
  } as Record<string, Array<{ id: string; kind: string; ticketId: string; status: string; createdAt: string }>>,
  decisionsByWs: { acme: [{ id: 'd1' }, { id: 'd2' }] } as Record<string, Array<{ id: string }>>,
  incidents: [{ resolvedAt: null }, { resolvedAt: '2026-09-01' }] as Array<{ resolvedAt: string | null }>,
  fanIn: [] as string[][],
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
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => () => undefined,
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspaces, isError: false }),
  useWorkspaceProjects: (ids: readonly string[]) =>
    Object.fromEntries(ids.map((id) => [id, { status: 'success', projects: state.projectsByWs[id] ?? [] }])),
  useWorkersMany: (ids: readonly string[]) => ids.map((id) => ({ data: state.workersByWs[id] ?? [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map((id) => (id in state.decisionsByWs ? { data: state.decisionsByWs[id] } : { data: undefined })),
  useIncidents: () => ({ data: { items: state.incidents, total: state.incidents.length } }),
  useMe: () => ({
    data: { operator: { username: 'victor' }, session: { id: 's', kind: 'web' }, totpEnabled: false },
  }),
}));

const onTheme = vi.fn();

const { V2Shell } = await import('../v2/V2Shell');
const { V2Page } = await import('../v2/V2Page');

function mountShell(): ReturnType<typeof render> {
  return render(<V2Shell theme="dark" onTheme={onTheme} />);
}

beforeEach(() => {
  state.path = '/v2/w/acme/work';
  state.workspaces = [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 }];
  state.projectsByWs = { acme: [{ id: 'p1', slug: 'web', name: 'web' }] };
  state.workersByWs = {
    acme: [
      { id: 'w1', kind: 'worker', ticketId: 't1', status: 'running', createdAt: '2026-09-13T00:00:00Z' },
      { id: 'w2', kind: 'worker', ticketId: 't2', status: 'done', createdAt: '2026-09-13T00:00:00Z' },
    ],
  };
  state.decisionsByWs = { acme: [{ id: 'd1' }, { id: 'd2' }] };
  state.fanIn = [];
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
    state.path = '/v2/w/acme/needs';
    mountShell();
    const rail = screen.getByRole('complementary');
    const current = within(rail)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/v2/w/acme/needs');
  });
});

describe('scope preservation', () => {
  it('builds workspace rows against the current workspace and leaves global rows global', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: /Work/ })).toHaveAttribute('href', '/v2/w/acme/work');
    expect(within(rail).getByRole('link', { name: /Roles/ })).toHaveAttribute('href', '/v2/w/acme/roles');
    expect(within(rail).getAllByRole('link', { name: /Needs you/ })[0]).toHaveAttribute('href', '/v2/needs');
  });
});

describe('each workspace group lists its own projects', () => {
  it('shows only its own projects from either workspace’s screen', () => {
    state.workspaces = [
      { id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 },
      { id: 'beta', name: 'Beta', ticketPrefix: 'BETA', root: '', projects: [], needsYou: 0 },
    ];
    state.projectsByWs = {
      acme: [{ id: 'p1', slug: 'web', name: 'web' }],
      beta: [{ id: 'p2', slug: 'api', name: 'api' }],
    };
    state.decisionsByWs = { acme: [], beta: [] };
    for (const path of ['/v2/w/acme/work', '/v2/w/beta/work']) {
      state.path = path;
      mountShell();
      const rail = screen.getByRole('complementary');
      expect(within(rail).getAllByRole('link', { name: 'web' })).toHaveLength(1);
      expect(within(rail).getByRole('link', { name: 'web' })).toHaveAttribute('href', '/v2/w/acme/p/web');
      expect(within(rail).getAllByRole('link', { name: 'api' })).toHaveLength(1);
      expect(within(rail).getByRole('link', { name: 'api' })).toHaveAttribute('href', '/v2/w/beta/p/api');
      cleanup();
    }
  });
});

describe('the rail counts', () => {
  it('renders the Live and Needs you counts from seeded workers and decisions, with no interaction', () => {
    mountShell();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByRole('link', { name: /Live/ })).toHaveTextContent('1');
    const needs = within(rail).getAllByRole('link', { name: /Needs you/ });
    expect(needs.find((a) => a.getAttribute('href') === '/v2/needs')).toHaveTextContent('2');
    expect(needs.find((a) => a.getAttribute('href') === '/v2/w/acme/needs')).toHaveTextContent('2');
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
    // The desktop rail's More… button opens the same list as the phone tab bar's More.
    fireEvent.click(within(screen.getByRole('complementary')).getByText('More…'));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    expect(within(dialog).queryByText('Knowledge graph')).toBeNull();
    expect(within(dialog).queryByText('Knowledge explorer')).toBeNull();
    // The kept screens that have no rail row are still reached here.
    expect(within(dialog).getByText('Chats')).toBeInTheDocument();
    expect(within(dialog).getByText('Changelog')).toBeInTheDocument();
  });
});

describe('the one-click way back to V1', () => {
  it('links the rail footer to /', () => {
    mountShell();
    expect(screen.getByRole('link', { name: 'V1' })).toHaveAttribute('href', '/');
  });
});

describe('live streams on global pages (VS-366, VS-369)', () => {
  it('opens exactly one stream per listed workspace on a global page', () => {
    state.path = '/v2/needs';
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
    state.path = '/v2/chats';
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
