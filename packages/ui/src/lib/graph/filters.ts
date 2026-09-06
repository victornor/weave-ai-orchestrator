/**
 * What is drawn, what is lit and what is dimmed: search, the group toggles and the neighbourhood
 * highlight, kept out of the component so each of them is a function with a test rather than a
 * condition buried in JSX.
 *
 * The two mechanisms are deliberately different. Hiding a group *removes* its nodes — they leave
 * the drawing and the layout, and the rest of the graph settles into the space. Searching only
 * *dims*: a match must be findable in the shape the reader already has, so nothing moves.
 */
import { neighbourhood, type GraphEdge, type GraphModel } from './model';

/** Case-insensitive substring match on a title. An empty query matches nothing in particular. */
export function matchesQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return title.toLowerCase().includes(q);
}

/** The ids whose titles match, or `null` when there is no query — which is not the same as none. */
export function matchingIds(model: GraphModel, query: string): Set<string> | null {
  if (!query.trim()) return null;
  const out = new Set<string>();
  for (const n of model.nodes) if (matchesQuery(n.title, query)) out.add(n.id);
  return out;
}

/**
 * The model restricted to the groups still switched on: what is drawn *and* what is laid out, since
 * hiding a group has to let the rest settle into the space. An edge needs both of its ends.
 *
 * A node keeps the degree it has in the whole graph, so that its size means "how linked this page
 * is" rather than "how linked it is right now" — toggling a legend must not resize the survivors.
 */
export function visible(model: GraphModel, hidden: ReadonlySet<string>): GraphModel {
  if (hidden.size === 0) return model;
  const nodes = model.nodes.filter((n) => !hidden.has(n.group));
  const kept = new Set(nodes.map((n) => n.id));
  const edges = model.edges.filter((e) => kept.has(e.source) && kept.has(e.target));

  const neighbours = new Map<string, Set<string>>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    neighbours.set(n.id, new Set([...(model.neighbours.get(n.id) ?? [])].filter((id) => kept.has(id))));
    outgoing.set(n.id, (model.outgoing.get(n.id) ?? []).filter((id) => kept.has(id)));
    incoming.set(n.id, (model.incoming.get(n.id) ?? []).filter((id) => kept.has(id)));
  }

  return {
    nodes,
    edges,
    byId: new Map(nodes.map((n) => [n.id, n])),
    groups: model.groups.filter((g) => !hidden.has(g)),
    neighbours,
    outgoing,
    incoming,
  };
}

export interface Focus {
  /** The hovered node, or the selected one when nothing is hovered. */
  focus: string | null;
  matches: Set<string> | null;
}

/** The lit neighbourhood — the focused node and its direct neighbours — or `null` for none. */
export function highlighted(model: GraphModel, focus: string | null): Set<string> | null {
  if (!focus || !model.byId.has(focus)) return null;
  return neighbourhood(model, focus);
}

/**
 * Is this node pushed into the background? A node is dimmed when a neighbourhood is lit and it is
 * outside it, or when a search is running and it does not match. The two compose: searching while
 * hovering leaves only the matching part of the neighbourhood prominent.
 */
export function nodeDimmed(id: string, lit: ReadonlySet<string> | null, matches: ReadonlySet<string> | null): boolean {
  if (lit && !lit.has(id)) return true;
  if (matches && !matches.has(id)) return true;
  return false;
}

/** An edge stays prominent only while both of its ends do. */
export function edgeDimmed(edge: GraphEdge, lit: ReadonlySet<string> | null, matches: ReadonlySet<string> | null): boolean {
  return nodeDimmed(edge.source, lit, matches) || nodeDimmed(edge.target, lit, matches);
}
