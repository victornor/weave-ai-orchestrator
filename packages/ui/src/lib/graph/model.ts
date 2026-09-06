/**
 * The knowledge graph as the view needs it, derived once from what `GET /knowledge/graph` returns.
 *
 * The API hands back one node per knowledge file and one edge per resolved `[[link]]`, which is a
 * link *occurrence*: a page that links to the same page twice is two rows, and a pair of pages that
 * cite each other is two rows pointing opposite ways. Neither is a thing to draw. This module
 * collapses them into the edges a reader should see — one line per pair, with an arrowhead only
 * where the link really is one-way — and precomputes the adjacency the highlight, the detail panel
 * and the neighbour list all ask for.
 */
import type { KnowledgeGraph } from '../../api/types';

export type GraphNodeKind = 'hub' | 'doc';

export interface GraphNode {
  /** The knowledge path, e.g. `projects/api/docs/payments-webhooks.md`. Stable across refetches. */
  id: string;
  kind: GraphNodeKind;
  title: string;
  /** What the node is coloured and clustered by: its project when it has one, else its scope. */
  group: string;
  scope: string;
  projectSlug: string | null;
  tokens: number;
  /** Distinct neighbours, counting a reciprocal pair once. What the node's size encodes. */
  degree: number;
}

export interface GraphEdge {
  /** Stable key for React and for the ref map that writes this edge's geometry. */
  id: string;
  source: string;
  target: string;
  /** False when the two pages cite each other: a mutual link gets one plain line, not two arrows. */
  directed: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
  /** Every group present, sorted, for the legend and the cluster hulls. */
  groups: string[];
  /** Undirected adjacency: who is one hop away. */
  neighbours: Map<string, Set<string>>;
  /** Pages this page links to. */
  outgoing: Map<string, string[]>;
  /** Pages that link to this page. */
  incoming: Map<string, string[]>;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Build the model. Unknown endpoints, self-links and repeated links are dropped. */
export function buildModel(graph: KnowledgeGraph): GraphModel {
  const byId = new Map<string, GraphNode>();
  const nodes: GraphNode[] = graph.nodes.map((n) => {
    const node: GraphNode = {
      id: n.id,
      kind: n.kind,
      title: n.title,
      group: n.projectSlug ?? n.scope,
      scope: n.scope,
      projectSlug: n.projectSlug,
      tokens: n.tokens,
      degree: 0,
    };
    byId.set(node.id, node);
    return node;
  });

  const neighbours = new Map<string, Set<string>>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    neighbours.set(n.id, new Set());
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }

  // One pass over the link rows: remember which directions exist for each unordered pair.
  const pairs = new Map<string, { a: string; b: string; ab: boolean; ba: boolean }>();
  for (const e of graph.edges) {
    if (e.from === e.to) continue;
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
    const key = `${a}\u0000${b}`;
    const pair = pairs.get(key) ?? { a: a!, b: b!, ab: false, ba: false };
    if (e.from === a) pair.ab = true;
    else pair.ba = true;
    pairs.set(key, pair);
    if (!outgoing.get(e.from)!.includes(e.to)) outgoing.get(e.from)!.push(e.to);
    if (!incoming.get(e.to)!.includes(e.from)) incoming.get(e.to)!.push(e.from);
    neighbours.get(e.from)!.add(e.to);
    neighbours.get(e.to)!.add(e.from);
  }

  const edges: GraphEdge[] = [];
  for (const [key, { a, b, ab, ba }] of pairs) {
    // Draw from whichever end actually points at the other; a mutual pair loses its arrowhead.
    edges.push({ id: key, source: ab ? a : b, target: ab ? b : a, directed: !(ab && ba) });
  }

  for (const n of nodes) n.degree = neighbours.get(n.id)!.size;

  const groups = [...new Set(nodes.map((n) => n.group))].sort();
  return { nodes, edges, byId, groups, neighbours, outgoing, incoming };
}

/** The nodes one hop from `id`, or an empty set for a node the model does not know. */
export function neighboursOf(model: GraphModel, id: string): ReadonlySet<string> {
  return model.neighbours.get(id) ?? EMPTY;
}

/** `id` and everything one hop from it: what a hover or a selection lights up. */
export function neighbourhood(model: GraphModel, id: string): Set<string> {
  return new Set<string>([id, ...neighboursOf(model, id)]);
}
