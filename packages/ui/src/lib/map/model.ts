/**
 * The instance Map as a graph: workspaces, projects, roles, in-flight tickets and knowledge
 * nodes, with ownership edges. Pure — the route fans out HTTP and this assembles what to draw.
 */
import { projectLabel, type Project, type Role, type Ticket } from '@weave-ai/shared';

export const IN_FLIGHT_TICKET_STATUSES = [
  'proposing', 'proposed', 'approved', 'in_progress', 'in_review', 'merging', 'blocked',
] as const;

export type MapNodeKind = 'workspace' | 'project' | 'weaver' | 'role' | 'ticket' | 'knowledge';

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
  /** When this node has one: a role, a ticket, or a knowledge node (its newest file). */
  updatedAt: string | null;
  /** Only set on a `ticket` node — drives its status colour. */
  ticketStatus?: Ticket['status'];
  /** Only set on `workspace`/`project` nodes: true when an in-flight ticket sits under it. */
  hasLiveActivity?: boolean;
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
  knowledge: readonly { projectId: string | null; updatedAt: string }[];
  weaver: { id: string; name: string } | null;
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
    const wsNode: MapNode = {
      id: wsId,
      kind: 'workspace',
      title: w.name,
      workspaceId: w.id,
      workspaceName: w.name,
      href: `/w/${encodeURIComponent(w.id)}/needs`,
      updatedAt: null,
      hasLiveActivity: false,
    };
    push(wsNode);

    if (w.weaver) {
      const cid = nodeId('weaver', w.weaver.id);
      push({
        id: cid,
        kind: 'weaver',
        title: w.weaver.name,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/chat`,
        updatedAt: null,
      });
      addEdge(edges, neighbours, wsId, cid);
    }

    const projectById = new Map(w.projects.map((p) => [p.id, p]));
    for (const p of w.projects) {
      const pid = nodeId('project', p.id);
      push({
        id: pid,
        kind: 'project',
        title: projectLabel(p),
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/p/${encodeURIComponent(p.slug)}`,
        projectId: p.id,
        projectSlug: p.slug,
        updatedAt: null,
        hasLiveActivity: false,
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
        updatedAt: r.updatedAt,
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
        updatedAt: t.updatedAt,
        ticketStatus: t.status,
      });
      const roleId = t.assigneeRoleId && liveRoles.has(t.assigneeRoleId) ? nodeId('role', t.assigneeRoleId) : null;
      if (roleId && byId.has(roleId)) addEdge(edges, neighbours, roleId, tid);
      else if (project) addEdge(edges, neighbours, nodeId('project', project.id), tid);
      else addEdge(edges, neighbours, wsId, tid);
      wsNode.hasLiveActivity = true;
      if (project) {
        const projectNode = byId.get(nodeId('project', project.id));
        if (projectNode) projectNode.hasLiveActivity = true;
      }
    }

    const knowledgeProjects = new Map<string, string>();
    let workspaceKnowledgeUpdatedAt: string | null = null;
    for (const f of w.knowledge) {
      if (f.projectId && projectById.has(f.projectId)) {
        const latest = knowledgeProjects.get(f.projectId);
        if (!latest || f.updatedAt > latest) knowledgeProjects.set(f.projectId, f.updatedAt);
      } else if (!f.projectId) {
        if (!workspaceKnowledgeUpdatedAt || f.updatedAt > workspaceKnowledgeUpdatedAt) workspaceKnowledgeUpdatedAt = f.updatedAt;
      }
    }
    for (const [projectId, updatedAt] of knowledgeProjects) {
      const project = projectById.get(projectId)!;
      const kid = `knowledge:project:${projectId}`;
      push({
        id: kid,
        kind: 'knowledge',
        title: `${projectLabel(project)} knowledge`,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/knowledge`,
        search: { project: projectId, tab: 'knowledge' },
        projectId,
        projectSlug: project.slug,
        updatedAt,
      });
      addEdge(edges, neighbours, nodeId('project', projectId), kid);
    }
    if (workspaceKnowledgeUpdatedAt) {
      const kid = `knowledge:ws:${w.id}`;
      push({
        id: kid,
        kind: 'knowledge',
        title: `${w.name} knowledge`,
        workspaceId: w.id,
        workspaceName: w.name,
        href: `/w/${encodeURIComponent(w.id)}/knowledge`,
        search: { tab: 'knowledge' },
        updatedAt: workspaceKnowledgeUpdatedAt,
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
