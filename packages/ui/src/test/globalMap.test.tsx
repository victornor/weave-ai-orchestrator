/** VS-176/VS-192: daemon-wide Map page. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, Ticket } from '@agent-conductor/shared';
import type { WorkerListItem, WorkspaceProjectsState } from '../api/hooks';
import { agent, project, ticket } from './factories';

const go = vi.fn();
const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  workspacesError: false,
  projects: {} as Record<string, WorkspaceProjectsState>,
  roles: {} as Record<string, Role[] | undefined>,
  tickets: {} as Record<string, Ticket[] | undefined>,
  knowledge: {} as Record<string, { files: Array<{ projectId: string | null; updatedAt: string }> } | undefined>,
  workers: {} as Record<string, WorkerListItem[] | undefined>,
  errors: {} as Record<string, boolean>,
  conductors: {} as Record<string, { agent: { id: string; name: string } } | undefined>,
  reduced: false,
  phone: false,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: React.ReactNode }) => (
    <a href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)} {...rest}>{children}</a>
  ),
  useGo: () => go,
}));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspacesError ? undefined : state.workspaces, isError: state.workspacesError, refetch: vi.fn() }),
  useWorkspaceProjects: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, state.projects[id] ?? { status: 'pending', projects: [] }])),
  useRolesMany: (ids: string[]) => ids.map((id) => ({ data: state.roles[id], isError: Boolean(state.errors[id]), refetch: vi.fn() })),
  useTicketsMany: (ids: string[]) => ids.map((id) => ({ data: state.tickets[id], isError: Boolean(state.errors[id]), refetch: vi.fn() })),
  useKnowledgeIndexMany: (ids: string[]) => ids.map((id) => ({ data: state.knowledge[id], isError: Boolean(state.errors[id]), refetch: vi.fn() })),
  useWeaverMany: (ids: string[]) => ids.map((id) => ({ data: state.conductors[id], isError: false })),
  useWorkersMany: (ids: string[]) => ids.map((id) => ({ data: state.workers[id] ?? [], isError: false })),
}));

const { GlobalMapRoute } = await import('../routes/GlobalMap');

function role(over: Partial<Role> = {}): Role {
  return {
    id: 'r1', workspaceId: 'alpha', projectId: 'p1', slug: 'pe', name: 'Platform Engineer', title: null, icon: null,
    charterSummary: '', scopeText: '', responsibilities: [], capabilities: [], rules: [], permission: {},
    sessionPolicy: 'per_ticket', maxWorkers: 2, secrets: [], status: 'active', pauseReason: null, specRevision: 1,
    createdBy: 'c', createdAt: '', updatedAt: '', ...over,
  };
}

function worker(over: Partial<WorkerListItem> = {}): WorkerListItem {
  return { ...agent(over), interactiveSession: false, ...over };
}

function ready(over: Partial<typeof state> = {}): void {
  state.workspaces = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }];
  state.workspacesError = false;
  state.projects = {
    alpha: { status: 'success', projects: [project({ id: 'p1', slug: 'api', workspaceId: 'alpha' })] },
    beta: { status: 'success', projects: [project({ id: 'p2', slug: 'web', workspaceId: 'beta' })] },
  };
  state.roles = { alpha: [role()], beta: [] };
  state.tickets = {
    alpha: [ticket({ id: 't1', identifier: 'VS-176', title: 'Map', status: 'in_progress', assigneeRoleId: 'r1', projectId: 'p1' })],
    beta: [],
  };
  state.knowledge = {
    alpha: { files: [{ projectId: 'p1', updatedAt: '2026-09-01T00:00:00.000Z' }, { projectId: 'p1', updatedAt: '2026-09-02T00:00:00.000Z' }] },
    beta: { files: [] },
  };
  state.workers = {};
  state.errors = {};
  state.conductors = { alpha: { agent: { id: 'c1', name: 'Conductor' } }, beta: undefined };
  state.reduced = false;
  state.phone = false;
  Object.assign(state, over);
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduced-motion') ? state.reduced : q.includes('max-width') ? state.phone : false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  go.mockClear();
  ready();
});

async function draw(): Promise<HTMLElement> {
  const { container } = render(<GlobalMapRoute />);
  await screen.findByLabelText('Instance map');
  return container;
}

describe('GlobalMapRoute', () => {
  it('shows nodes for two workspaces, a role, an in-flight ticket and one knowledge node', async () => {
    const container = await draw();
    const labels = [...container.querySelectorAll('[data-node]')].map((n) => n.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'api', 'web', 'Platform Engineer', 'VS-176 Map', 'api knowledge', 'Conductor']));
    expect(container.querySelectorAll('[data-kind="knowledge"]')).toHaveLength(1);
  });

  it('excludes todo, done and retired roles', async () => {
    ready({
      roles: { alpha: [role({ id: 'dead', status: 'retired' }), role({ id: 'live', name: 'Alive' })], beta: [] },
      tickets: {
        alpha: [
          ticket({ id: 'todo', identifier: 'VS-1', status: 'todo', title: 'Queued' }),
          ticket({ id: 'done', identifier: 'VS-2', status: 'done', title: 'Shipped' }),
          ticket({ id: 'run', identifier: 'VS-3', status: 'in_progress', title: 'Running', assigneeRoleId: 'live' }),
        ],
        beta: [],
      },
    });
    const container = await draw();
    const labels = [...container.querySelectorAll('[data-node]')].map((n) => n.getAttribute('aria-label'));
    expect(labels).not.toContain('Queued');
    expect(labels?.some((l) => l?.includes('VS-1'))).toBe(false);
    expect(labels?.some((l) => l?.includes('VS-2'))).toBe(false);
    expect(labels).toEqual(expect.arrayContaining(['Alive', 'VS-3 Running']));
    expect(labels?.some((l) => l === 'Platform Engineer')).toBe(false);
  });

  it('shows an empty workspace as a lone node with no error', async () => {
    ready({
      projects: {
        alpha: { status: 'success', projects: [project({ id: 'p1', slug: 'api' })] },
        beta: { status: 'success', projects: [] },
      },
      roles: { alpha: [role()], beta: [] },
      tickets: { alpha: [ticket({ id: 't1', identifier: 'VS-176', title: 'Map', status: 'in_progress' })], beta: [] },
      knowledge: { alpha: { files: [] }, beta: { files: [] } },
    });
    await draw();
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
    expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
  });

  it('keeps the other workspace when one fails, with retry', async () => {
    ready({
      errors: { alpha: true },
      roles: { alpha: undefined, beta: [] },
      tickets: { alpha: undefined, beta: [] },
      knowledge: { alpha: undefined, beta: { files: [] } },
    });
    await draw();
    expect(screen.getByText(/Could not load Alpha/)).toBeInTheDocument();
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows loading, not the empty state, while a workspace is still pending', () => {
    ready({
      projects: {
        alpha: { status: 'pending', projects: [] },
        beta: { status: 'success', projects: [] },
      },
      roles: { alpha: undefined, beta: [] },
      tickets: { alpha: undefined, beta: [] },
      knowledge: { alpha: undefined, beta: { files: [] } },
    });
    render(<GlobalMapRoute />);
    expect(screen.queryByText('No workspaces yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing to draw yet.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Instance map')).not.toBeInTheDocument();
  });

  it('says so when the daemon hosts no workspaces', () => {
    ready({ workspaces: [], projects: {}, roles: {}, tickets: {}, knowledge: {} });
    render(<GlobalMapRoute />);
    expect(screen.getByText('No workspaces yet.')).toBeInTheDocument();
  });

  it('opens a ticket and a project from the detail panel', async () => {
    const container = await draw();
    fireEvent.click(container.querySelector('[data-node="ticket:t1"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'alpha', ticketId: 'VS-176' } });

    go.mockClear();
    fireEvent.doubleClick(container.querySelector('[data-node="project:p1"]')!);
    expect(go).toHaveBeenCalledWith('/w/$ws/p/$project', { params: { ws: 'alpha', project: 'api' } });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('defaults to the neighbour list on a phone', async () => {
    ready({ phone: true });
    render(<GlobalMapRoute />);
    expect(await screen.findByText('neighbours')).toBeInTheDocument();
    expect(screen.queryByLabelText('Instance map')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));
    expect(await screen.findByLabelText('Instance map')).toBeInTheDocument();
  });

  it('settles without animation frames when reduced motion is on', async () => {
    ready({ reduced: true });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    await draw();
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it('draws a beam for a live worker holding an in-flight ticket, and it is not a node', async () => {
    ready({
      reduced: true,
      workers: { alpha: [worker({ id: 'w1', kind: 'worker', ticketId: 't1', status: 'running' })], beta: [] },
    });
    const container = await draw();
    // The beam is decorative: it adds no node (worker ids never appear as a `data-node`), and is
    // not itself aria-labelled or selectable — matching the ticket-count already asserted for
    // this fixture in "shows nodes for two workspaces...".
    const nodeIds = [...container.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-node'));
    expect(nodeIds.some((id) => id?.includes('w1'))).toBe(false);
    expect(screen.queryByLabelText('w1')).not.toBeInTheDocument();
  });

  it('does not draw a beam once the worker is no longer live', async () => {
    ready({
      reduced: true,
      workers: { alpha: [worker({ id: 'w1', kind: 'worker', ticketId: 't1', status: 'done' })], beta: [] },
    });
    const container = await draw();
    expect(container.querySelectorAll('[data-node]').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('w1')).not.toBeInTheDocument();
  });
});
