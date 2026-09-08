/** The rail's workspace list (`app/WorkspaceNav.tsx`) — VS-46. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceListItem } from '../api/types';
import type { WorkspaceProjectsState } from '../api/hooks';
import { project } from './factories';

// The rail assembles hrefs at runtime; rendering them as plain anchors is what lets a test read
// where each link actually points.
vi.mock('../app/link', () => ({
  // `params` are substituted into the path rather than spread onto the anchor, so a test reads the
  // address the human actually lands on.
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children: React.ReactNode }) => (
    <a href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)} {...rest}>{children}</a>
  ),
  useGo: () => vi.fn(),
}));

const { WorkspaceNav } = await import('../app/WorkspaceNav');

const workspace = (over: Partial<WorkspaceListItem> = {}): WorkspaceListItem => ({
  id: 'alpha', name: 'Alpha', ticketPrefix: 'ALP', root: '/tmp/alpha', projects: [], needsYou: 0, ...over,
});

const WORKSPACES = [
  workspace(),
  workspace({ id: 'beta', name: 'Beta', ticketPrefix: 'BET', needsYou: 3 }),
  workspace({ id: 'gamma', name: 'Gamma', ticketPrefix: 'GAM' }),
];

const ready = (projects: ReturnType<typeof project>[] = []): WorkspaceProjectsState => ({ status: 'success', projects });
const pending: WorkspaceProjectsState = { status: 'pending', projects: [] };
const failed: WorkspaceProjectsState = { status: 'error', projects: [] };

function nav(over: Partial<React.ComponentProps<typeof WorkspaceNav>> = {}): React.ReactElement {
  return (
    <WorkspaceNav
      workspaces={WORKSPACES}
      activeWs="alpha"
      activePath="/w/alpha/chat"
      expanded={[]}
      onToggle={vi.fn()}
      needsCount={0}
      projectsByWs={{ alpha: ready() }}
      onNewWorkspace={vi.fn()}
      {...over}
    />
  );
}

const group = (name: string): HTMLElement => screen.getByLabelText(`${name} sections`);

describe('listing workspaces', () => {
  it('shows every workspace the daemon reports', () => {
    render(nav());
    for (const name of ['Alpha', 'Beta', 'Gamma']) expect(screen.getByText(name)).toBeInTheDocument();
  });

  it('nests the eight sections under an expanded workspace', () => {
    render(nav({ expanded: ['beta'] }));
    const beta = group('Beta');
    for (const label of ['Chat', 'Needs you', 'Board', 'Team', 'Runs', 'Usage', 'Knowledge', 'Settings']) {
      expect(within(beta).getByText(label)).toBeInTheDocument();
    }
  });

  it('shows a collapsed workspace as a header alone', () => {
    render(nav());
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByLabelText('Beta sections')).not.toBeInTheDocument();
  });

  it('addresses each section of each workspace directly', () => {
    render(nav({ expanded: ['beta'] }));
    expect(within(group('Beta')).getByText('Board').closest('a')).toHaveAttribute('href', '/w/beta/board');
    expect(within(group('Alpha')).getByText('Chat').closest('a')).toHaveAttribute('href', '/w/alpha/chat');
  });

  it('keeps a new-workspace action in the sidebar', () => {
    const onNewWorkspace = vi.fn();
    render(nav({ onNewWorkspace }));
    fireEvent.click(screen.getByText('New workspace'));
    expect(onNewWorkspace).toHaveBeenCalled();
  });
});

describe('expansion', () => {
  it('reports its state and toggles on the header', () => {
    const onToggle = vi.fn();
    render(nav({ onToggle }));
    const header = screen.getByText('Beta').closest('button');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header!);
    expect(onToggle).toHaveBeenCalledWith('beta');
  });

  it('reports an expanded workspace as expanded', () => {
    render(nav({ expanded: ['beta'] }));
    expect(screen.getByText('Beta').closest('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the active workspace open with no control that would collapse it', () => {
    render(nav({ expanded: [] }));
    expect(screen.queryByLabelText('Alpha sections')).toBeInTheDocument();
    expect(screen.getByText('Alpha').closest('button')).toBeNull();
  });
});

describe('the active workspace and section', () => {
  it('marks the current section, and only in the active workspace', () => {
    render(nav({ activeWs: 'alpha', activePath: '/w/alpha/board', expanded: ['beta'] }));
    expect(within(group('Alpha')).getByText('Board').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(within(group('Beta')).getByText('Board').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('hints the shortcut only where the keys reach', () => {
    render(nav({ expanded: ['beta'] }));
    // `,` rather than a number: a number would also match a Needs-you badge.
    expect(within(group('Alpha')).getByText(',')).toBeInTheDocument();
    expect(within(group('Beta')).queryByText(',')).not.toBeInTheDocument();
  });

  it('lists the active workspace"s projects, and a non-active but unexpanded workspace has none loaded', () => {
    render(nav({ projectsByWs: { alpha: ready([project()]) }, expanded: [] }));
    expect(screen.getByLabelText('Alpha projects')).toBeInTheDocument();
    expect(screen.queryByLabelText('Beta projects')).not.toBeInTheDocument();
  });

  // VS-95: a project used to open the board with its filter set; it now opens its own overview,
  // from which the board is one click on.
  it('opens a project"s overview, addressed by its slug', () => {
    render(nav({ projectsByWs: { alpha: ready([project({ id: 'p1', slug: 'web' })]) } }));
    const link = within(screen.getByLabelText('Alpha projects')).getByText('web').closest('a');
    expect(link?.getAttribute('href')).toBe('/w/alpha/p/web');
  });

  // VS-128: expanding another workspace now fetches and lists its own projects too.
  it('lists a non-active workspace"s projects once its group is expanded and loaded', () => {
    render(nav({ projectsByWs: { alpha: ready(), beta: ready([project({ id: 'p2', slug: 'api' })]) }, expanded: ['beta'] }));
    const link = within(screen.getByLabelText('Beta projects')).getByText('api').closest('a');
    expect(link?.getAttribute('href')).toBe('/w/beta/p/api');
  });

  it('shows a loading state rather than treating an outstanding fetch as empty', () => {
    render(nav({ projectsByWs: { alpha: ready(), beta: pending }, expanded: ['beta'] }));
    const group = screen.getByLabelText('Beta projects');
    expect(within(group).getByRole('status')).toBeInTheDocument();
  });

  it('shows a genuinely empty workspace as no project block, not an error or loading state', () => {
    render(nav({ projectsByWs: { alpha: ready(), beta: ready([]) }, expanded: ['beta'] }));
    expect(screen.queryByLabelText('Beta projects')).not.toBeInTheDocument();
  });

  it('scopes a failed fetch to its own group, leaving another expanded group unaffected', () => {
    render(nav({
      projectsByWs: { alpha: ready(), beta: failed, gamma: ready([project({ id: 'p3', slug: 'gam-proj' })]) },
      expanded: ['beta', 'gamma'],
    }));
    expect(within(screen.getByLabelText('Beta projects')).getByRole('alert')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Gamma projects')).getByText('gam-proj')).toBeInTheDocument();
  });

  it('does not refetch on re-expansion: a workspace absent from projectsByWs after being collapsed keeps no stale block', () => {
    // Collapsing drops a workspace out of `expanded`; WorkspaceNav itself renders purely from props,
    // so a collapsed group simply stops being open — AppShell (not this component) is what keeps the
    // cached result for the next expansion, per the `useWorkspaceProjects` hook.
    const { rerender } = render(nav({ projectsByWs: { alpha: ready(), beta: ready([project({ id: 'p2', slug: 'api' })]) }, expanded: ['beta'] }));
    expect(screen.getByLabelText('Beta projects')).toBeInTheDocument();
    rerender(nav({ projectsByWs: { alpha: ready(), beta: ready([project({ id: 'p2', slug: 'api' })]) }, expanded: [] }));
    expect(screen.queryByLabelText('Beta projects')).not.toBeInTheDocument();
  });

  // VS-128: a non-active project's link already carries its own workspace id, so following it
  // switches the active workspace as part of the same navigation, with no extra click handler.
  it('addresses a non-active workspace"s project with that workspace"s id, switching it on navigation', () => {
    render(nav({ projectsByWs: { alpha: ready(), beta: ready([project({ id: 'p2', slug: 'api' })]) }, expanded: ['beta'] }));
    const link = within(screen.getByLabelText('Beta projects')).getByText('api').closest('a');
    expect(link?.getAttribute('href')).toBe('/w/beta/p/api');
  });
});

describe('the Needs-you count', () => {
  it('shows a collapsed workspace its own count', () => {
    render(nav());
    expect(screen.getByLabelText('3 waiting for you')).toHaveTextContent('3');
  });

  it('prefers the live count over the listed one for the active workspace', () => {
    // The list says 9 but the live query says 2: the workspace being shown follows the live value.
    render(nav({ workspaces: [workspace({ needsYou: 9 }), ...WORKSPACES.slice(1)], needsCount: 2 }));
    expect(screen.getByLabelText('2 waiting for you')).toBeInTheDocument();
    expect(screen.queryByLabelText('9 waiting for you')).not.toBeInTheDocument();
  });

  it('shows nothing at all rather than a zero', () => {
    render(nav({ workspaces: [workspace()], needsCount: 0 }));
    expect(screen.queryByLabelText(/waiting for you/)).not.toBeInTheDocument();
  });
});
