/** The V2 shell: the rail's rows, the single highlighted row, scope preservation, collapse, theme. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ path: '/v2/w/acme/work' }));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => state.path,
  useParams: () => ({ ws: 'acme' }),
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
  useWorkspaces: () => ({
    data: [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 2 }],
    isError: false,
  }),
  useWorkspaceProjects: () => ({
    acme: { status: 'success', projects: [{ id: 'p1', slug: 'web', name: 'web' }] },
  }),
  useWorkers: () => ({ data: [{ status: 'running' }, { status: 'done' }] }),
  useIncidents: () => ({ data: { items: [{ resolvedAt: null }, { resolvedAt: '2026-09-01' }], total: 2 } }),
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
});

describe('the one-click way back to V1', () => {
  it('links the rail footer to /', () => {
    mountShell();
    expect(screen.getByRole('link', { name: 'V1' })).toHaveAttribute('href', '/');
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
});
