/**
 * The instance Map as a graph: workspaces, projects, roles, in-flight tickets and knowledge
 * nodes, with ownership edges. Pure — the route fans out HTTP and this assembles what to draw.
 */
import type { Project, Role, Ticket } from '@agent-conductor/shared';

export const IN_FLIGHT_TICKET_STATUSES = [
  'proposing', 'proposed', 'approved', 'in_progress', 'in_review', 'merging', 'blocked',
] as const;

export type MapNodeKind = 'workspace' | 'project' | 'conductor' | 'role' | 'ticket' | 'knowledge';

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  title: string;
  workspaceId: string;
  workspaceName: string;
  href: string;
  search?: Record<string, string>;
  projectId?: string;
  projectSlug?: string;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
}

export interface MapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  byId: Map<string, MapNode>;
  neighbours: Map<string, Set<string>>;
}

export interface MapWorkspaceInput {
  id: string;
  name: string;
  projects: readonly Project[];
  roles: readonly Role[];
  tickets: readonly Ticket[];
  knowledge: readonly { projectId: string | null }[];
  conductor: { id: string; name: string } | null;
}

const EMPTY: MapModel = { nodes: [], edges: [], byId: new Map(), neighbours: new Map() };

export function isInFlight(status: Ticket['status']): boolean {
  return (IN_FLIGHT_TICKET_STATUSES as readonly string[]).includes(status);
}

function nodeId(kind: MapNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function addEdge(edges: MapEdge[], neighbours: Map<string, Set<string>>, source: string, target: string): void {
  if (source === target) return;
  const id = `${source}\u0000${target}`;
  if (edges.some((e) => e.id === id)) return;
  edges.push({ id, source, target });
  neighbours.get(source)?.add(target);
  neighbours.get(target)?.add(source);
}

/** Build the instance graph. Unknown endpoints and cross-workspace links are dropped. */
export function buildMapModel(workspaces: readonly MapWorkspaceInput[]): MapModel {
  if (!workspaces.length) return EMPTY;
  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  const neighbours = new Map<string, Set<string>>();
  const edges: MapEdge[] = [];

  const push = (n: MapNode): void => {
    nodes.push(n);
    byId.set(n.id, n);
    neighbours.set(n.id, new Set());
  };

  for (const w of workspaces) {
    const wsId = nodeId('workspace', w.id);
    push({
      id: wsId,
      kind: 'workspace',
      title: w.name,
      workspaceId: w.id,
      workspaceName: w.name,
      href: `/w/${encodeURIComponent(w.id)}/needs`,
    });

    if (w.conductor) {
      const cid = nodeId('conductor', w.conductor.id);
      push({
        id: cid,
        kind: 'conductor',
        title: w.conductor.name,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/chat`,
      });
      addEdge(edges, neighbours, wsId, cid);
    }

    const projectById = new Map(w.projects.map((p) => [p.id, p]));
    for (const p of w.projects) {
      const pid = nodeId('project', p.id);
      push({
        id: pid,
        kind: 'project',
        title: p.slug,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/p/${encodeURIComponent(p.slug)}`,
        projectId: p.id,
        projectSlug: p.slug,
      });
      addEdge(edges, neighbours, wsId, pid);
    }

    const liveRoles = new Set<string>();
    for (const r of w.roles) {
      if (r.status === 'retired') continue;
      const rid = nodeId('role', r.id);
      const project = projectById.get(r.projectId);
      push({
        id: rid,
        kind: 'role',
        title: r.name,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/team`,
        projectId: r.projectId,
        projectSlug: project?.slug,
      });
      liveRoles.add(r.id);
      const parent = project ? nodeId('project', project.id) : wsId;
      addEdge(edges, neighbours, parent, rid);
    }

    for (const t of w.tickets) {
      if (!isInFlight(t.status)) continue;
      const tid = nodeId('ticket', t.id);
      const project = t.projectId ? projectById.get(t.projectId) : undefined;
      push({
        id: tid,
        kind: 'ticket',
        title: `${t.identifier} ${t.title}`.trim(),
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/tickets/${encodeURIComponent(t.identifier)}`,
        projectId: t.projectId ?? undefined,
        projectSlug: project?.slug,
      });
      const roleId = t.assigneeRoleId && liveRoles.has(t.assigneeRoleId) ? nodeId('role', t.assigneeRoleId) : null;
      if (roleId && byId.has(roleId)) addEdge(edges, neighbours, roleId, tid);
      else if (project) addEdge(edges, neighbours, nodeId('project', project.id), tid);
      else addEdge(edges, neighbours, wsId, tid);
    }

    const knowledgeProjects = new Set<string>();
    let workspaceKnowledge = false;
    for (const f of w.knowledge) {
      if (f.projectId && projectById.has(f.projectId)) knowledgeProjects.add(f.projectId);
      else if (!f.projectId) workspaceKnowledge = true;
    }
    for (const projectId of knowledgeProjects) {
      const project = projectById.get(projectId)!;
      const kid = `knowledge:project:${projectId}`;
      push({
        id: kid,
        kind: 'knowledge',
        title: `${project.slug} knowledge`,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/knowledge`,
        search: { project: projectId, tab: 'knowledge' },
        projectId,
        projectSlug: project.slug,
      });
      addEdge(edges, neighbours, nodeId('project', projectId), kid);
    }
    if (workspaceKnowledge) {
      const kid = `knowledge:ws:${w.id}`;
      push({
        id: kid,
        kind: 'knowledge',
        title: `${w.name} knowledge`,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/knowledge`,
        search: { tab: 'knowledge' },
      });
      addEdge(edges, neighbours, wsId, kid);
    }
  }

  return { nodes, edges, byId, neighbours };
}

export function filterKinds(model: MapModel, hidden: ReadonlySet<MapNodeKind>): MapModel {
  if (hidden.size === 0) return model;
  const nodes = model.nodes.filter((n) => !hidden.has(n.kind));
  const kept = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const edges = model.edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  const neighbours = new Map<string, Set<string>>();
  for (const n of nodes) {
    neighbours.set(n.id, new Set([...(model.neighbours.get(n.id) ?? [])].filter((id) => kept.has(id))));
  }
  return { nodes, edges, byId, neighbours };
}
