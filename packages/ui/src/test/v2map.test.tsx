/** VS-350: the V2 Map — filters, legend, footer and node routing. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@weave-ai/shared';
import { agent, project } from './factories';

const state = vi.hoisted(() => ({
  workersByWs: {} as Record<string, Agent[]>,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/map' } }) : '/map'),
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({ useSearchParams: () => ({}), useGo: () => state.go }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme' }, { id: 'ws2', name: 'Fernwood' }], isError: false, refetch: vi.fn() }),
  useWorkersMany: (ids: string[]) => ids.map((id) => ({ data: state.workersByWs[id] ?? [] })),
  useWorkspaceProjects: () => ({
    ws1: { status: 'success', projects: [project({ id: 'p1', slug: 'web', name: 'web' })] },
    ws2: { status: 'success', projects: [project({ id: 'p2', slug: 'api', name: 'api' })] },
  }),
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
}));

const { MapBody } = await import('../v2/MapPage');
const { buildWorkerMapModel, pruneWorkerGraph, workerStatusesPresent } = await import('../v2/map/model');

const model = () =>
  buildWorkerMapModel([
    { id: 'ws1', name: 'Acme', projects: [project({ id: 'p1', slug: 'web' })], workers: state.workersByWs['ws1'] ?? [] },
    { id: 'ws2', name: 'Fernwood', projects: [project({ id: 'p2', slug: 'api' })], workers: state.workersByWs['ws2'] ?? [] },
  ]);

beforeEach(() => {
  state.go = vi.fn();
  state.workersByWs = {
    ws1: [
      agent({ id: 'a1', name: 'Backend Engineer #7', projectId: 'p1', status: 'running' }),
      agent({ id: 'a2', name: 'Infra Engineer #3', projectId: 'p1', status: 'error' }),
    ],
    ws2: [agent({ id: 'a3', name: 'Web Engineer #1', projectId: 'p2', status: 'active' })],
  };
});

describe('pruneWorkerGraph', () => {
  it('keeps only a workspace subgraph', () => {
    const pruned = pruneWorkerGraph(model(), 'ws1');
    expect(pruned.byId.has('worker:a1')).toBe(true);
    expect(pruned.byId.has('worker:a3')).toBe(false);
    expect(pruned.byId.has('project:p2')).toBe(false);
  });

  it('keeps attention workers with their project and workspace', () => {
    const pruned = pruneWorkerGraph(model(), 'attention');
    expect(pruned.byId.has('worker:a2')).toBe(true);
    expect(pruned.byId.has('worker:a1')).toBe(false);
    expect(pruned.byId.has('project:p1')).toBe(true);
    expect(pruned.byId.has('workspace:ws1')).toBe(true);
    expect(pruned.byId.has('workspace:ws2')).toBe(false);
  });
});

describe('workerStatusesPresent', () => {
  it('lists only the statuses actually present', () => {
    const statuses = workerStatusesPresent(pruneWorkerGraph(model(), 'attention'));
    expect(statuses).toEqual(['error']);
  });
});

describe('V2 Map', () => {
  it('routes each node kind to its screen', () => {
    render(<MapBody />);
    fireEvent.click(document.querySelector('[data-node="worker:a1"]') as HTMLElement);
    expect(state.go).toHaveBeenCalledWith('/live', { search: { worker: 'a1' } });

    fireEvent.click(document.querySelector('[data-node="project:p1"]') as HTMLElement);
    expect(state.go).toHaveBeenCalledWith('/w/$ws/work', { params: { ws: 'ws1' }, search: { project: 'p1' } });

    fireEvent.click(document.querySelector('[data-node="workspace:ws1"]') as HTMLElement);
    expect(state.go).toHaveBeenCalledWith('/w/$ws/chat', { params: { ws: 'ws1' } });
  });

  it('draws a shape per node kind', () => {
    render(<MapBody />);
    const workspace = document.querySelector('[data-node="workspace:ws1"]') as HTMLElement;
    expect(workspace.querySelector('circle')).not.toBeNull();
    expect(workspace.querySelector('rect')).toBeNull();
    expect(workspace.querySelector('polygon')).toBeNull();

    const proj = document.querySelector('[data-node="project:p1"]') as HTMLElement;
    expect(proj.querySelector('rect')).not.toBeNull();
    expect(proj.querySelector('circle')).toBeNull();
    expect(proj.querySelector('polygon')).toBeNull();

    const worker = document.querySelector('[data-node="worker:a1"]') as HTMLElement;
    expect(worker.querySelector('polygon')).not.toBeNull();
    expect(worker.querySelector('circle')).toBeNull();
    expect(worker.querySelector('rect')).toBeNull();
  });

  it('pans the graph with a drag through the viewport module', () => {
    render(<MapBody />);
    const svg = document.querySelector('[data-v2-map-canvas] svg') as SVGSVGElement;
    const group = document.querySelector('[data-v2-map-transform]') as SVGGElement;
    const before = group.getAttribute('transform');
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 120 });
    fireEvent.pointerUp(svg);
    expect(group.getAttribute('transform')).not.toBe(before);
    expect(group.getAttribute('transform')).toContain('translate');
  });

  it('prunes to attention and derives the legend from what is present', () => {
    render(<MapBody />);
    expect(screen.getByText('working')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attention' }));
    expect(document.querySelector('[data-node="worker:a2"]')).toBeTruthy();
    expect(document.querySelector('[data-node="worker:a1"]')).toBeNull();
    expect(document.querySelector('[data-node="worker:a3"]')).toBeNull();
    expect(screen.queryByText('working')).toBeNull();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('states what is shown in the footer', () => {
    render(<MapBody />);
    const footer = document.querySelector('[data-v2-map-footer]') as HTMLElement;
    expect(footer.textContent).toContain('3 workers shown');
    expect(footer.textContent).toContain('runs in');
  });
});
