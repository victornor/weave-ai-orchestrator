/**
 * The V2 Map model (VS-350): workspace → project → worker nodes with `runs in` edges.
 *
 * V1's `buildMapModel` is ticket-centric (roles, in-flight tickets and knowledge); the design's map
 * is worker-centric and its worker nodes open Live, so this builds the shared `MapModel` shape the
 * V2 canvas needs. The canvas reuses V1's pure layout and interaction modules (`lib/map/radial`,
 * `lib/map/labels`, `lib/map/drift`, `lib/graph/viewport`) unchanged.
 */
import { projectLabel, type Agent, type Project } from '@weave-ai/shared';
import type { MapEdge, MapModel, MapNode } from '../../lib/map/model';

export interface WorkerMapInput {
  id: string;
  name: string;
  projects: readonly Project[];
  workers: readonly Pick<Agent, 'id' | 'name' | 'projectId' | 'status'>[];
}

function nodeId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/** Build the V2 worker graph. A worker with no project on the workspace hangs off the workspace. */
export function buildWorkerMapModel(workspaces: readonly WorkerMapInput[]): MapModel {
  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  const neighbours = new Map<string, Set<string>>();
  const edges: MapEdge[] = [];

  const push = (n: MapNode): void => {
    nodes.push(n);
    byId.set(n.id, n);
    neighbours.set(n.id, new Set());
  };
  const addEdge = (source: string, target: string): void => {
    if (source === target || !byId.has(source) || !byId.has(target)) return;
    const id = `${source}\u0000${target}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push({ id, source, target });
    neighbours.get(source)?.add(target);
    neighbours.get(target)?.add(source);
  };

  for (const w of workspaces) {
    const wsId = nodeId('workspace', w.id);
    push({
      id: wsId,
      kind: 'workspace',
      title: w.name,
      workspaceId: w.id,
      workspaceName: w.name,
      href: `/w/${encodeURIComponent(w.id)}/chat`,
      updatedAt: null,
    });

    const projectById = new Map(w.projects.map((p) => [p.id, p]));
    for (const p of w.projects) {
      const pid = nodeId('project', p.id);
      push({
        id: pid,
        kind: 'project',
        title: projectLabel(p),
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/work`,
        search: { project: p.id },
        projectId: p.id,
        projectSlug: p.slug,
        updatedAt: null,
      });
      addEdge(wsId, pid);
    }

    for (const worker of w.workers) {
      const project = worker.projectId ? projectById.get(worker.projectId) : undefined;
      const wid = nodeId('worker', worker.id);
      push({
        id: wid,
        kind: 'worker',
        title: worker.name,
        workspaceId: w.id,
        workspaceName: w.name,
        href: '/live',
        search: { worker: worker.id },
        projectId: worker.projectId ?? undefined,
        projectSlug: project?.slug,
        updatedAt: null,
        workerStatus: worker.status,
      });
      addEdge(project ? nodeId('project', project.id) : wsId, wid);
    }
  }

  return { nodes, edges, byId, neighbours };
}

/** A worker that needs attention (the V2 Map's `Attention` filter): paused or errored. */
export function needsAttention(status: Agent['status'] | undefined): boolean {
  return status === 'paused' || status === 'error';
}

function rebuild(nodes: MapNode[], edges: MapEdge[]): MapModel {
  const ids = new Set(nodes.map((n) => n.id));
  const keptEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const neighbours = new Map<string, Set<string>>();
  for (const n of nodes) neighbours.set(n.id, new Set());
  for (const e of keptEdges) {
    neighbours.get(e.source)?.add(e.target);
    neighbours.get(e.target)?.add(e.source);
  }
  return { nodes, edges: keptEdges, byId, neighbours };
}

/**
 * Prune the worker graph for the map's filter row: `all` keeps everything, a workspace id keeps that
 * workspace's subgraph, and `attention` keeps only workers that need attention with their owning
 * project and workspace.
 */
export function pruneWorkerGraph(model: MapModel, scope: string): MapModel {
  if (scope === 'all') return model;
  const keep = new Set<string>();
  if (scope === 'attention') {
    const parentOf = (id: string): string | undefined => model.edges.find((e) => e.target === id)?.source;
    for (const n of model.nodes) {
      if (n.kind !== 'worker' || !needsAttention(n.workerStatus)) continue;
      keep.add(n.id);
      const parent = parentOf(n.id);
      if (parent) {
        keep.add(parent);
        const grand = parentOf(parent);
        if (grand) keep.add(grand);
      }
    }
  } else {
    for (const n of model.nodes) if (n.workspaceId === scope) keep.add(n.id);
  }
  return rebuild(model.nodes.filter((n) => keep.has(n.id)), model.edges);
}

/** The worker statuses actually present, in a stable order, for the legend. */
export function workerStatusesPresent(model: MapModel): Agent['status'][] {
  const order: Agent['status'][] = ['running', 'active', 'provisioning', 'paused', 'error', 'done', 'retired'];
  const present = new Set(model.nodes.filter((n) => n.kind === 'worker').map((n) => n.workerStatus).filter((s): s is Agent['status'] => Boolean(s)));
  return order.filter((s) => present.has(s));
}
