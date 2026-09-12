/**
 * The graph's nodes and links as `react-force-graph-2d` needs them: plain objects it mutates in
 * place every tick (`x`/`y`/`vx`/`vy`/`fx`/`fy` live directly on the node), plus the pure geometry
 * around them — radius, edge trimming to a node's circular boundary, and which labels a moment of
 * crowding should suppress. None of this touches the DOM, React, or the rendering library itself,
 * so it is unit-tested here rather than through a mounted canvas.
 */
import type { GraphModel, GraphNode, GraphNodeKind } from './model';
import type { Point } from './viewport';

export interface CanvasNode {
  id: string;
  title: string;
  kind: GraphNodeKind;
  group: string;
  degree: number;
  /** Drawn radius in graph units. */
  radius: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

export interface CanvasLink {
  id: string;
  source: string;
  target: string;
  directed: boolean;
}

const BASE_RADIUS = 4;
const HUB_BONUS = 2.5;
const DEGREE_SCALE = 1.6;
const MAX_RADIUS = 16;

/** A node's drawn radius: a hub starts larger, and both grow (capped) with link count. */
export function nodeRadius(node: Pick<GraphNode, 'kind' | 'degree'>): number {
  const base = BASE_RADIUS + (node.kind === 'hub' ? HUB_BONUS : 0);
  return Math.min(MAX_RADIUS, base + Math.sqrt(node.degree) * DEGREE_SCALE);
}

/** Where the line from a node's centre toward `(tx, ty)` crosses its own circular boundary. */
export function circleIntersection(cx: number, cy: number, r: number, tx: number, ty: number): Point {
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / len) * r, y: cy + (dy / len) * r };
}

/**
 * A ring wide enough that a full graph of brand-new nodes does not start seeded on top of itself.
 * Sized from the nodes' own footprint, ported from the old `lib/graph/simulation.ts`'s `seedRing`.
 */
function seedRing(nodes: readonly Pick<GraphNode, 'kind' | 'degree'>[]): number {
  if (nodes.length === 0) return 40;
  const totalDiameter = nodes.reduce((sum, n) => sum + nodeRadius(n) * 2, 0);
  return Math.max(60, (totalDiameter * 1.3) / (2 * Math.PI));
}

/** A stable pseudo-random angle for a node, so a layout never depends on `Math.random`. */
function angleOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Carry a layout across a data change (the "refresh animates instead of jumping" requirement).
 * Nodes that survive keep the exact same object — position, velocity, pin — so react-force-graph-2d
 * (which seeds `x`/`y` only for objects that do not already carry them) never re-seeds an
 * unchanged node. A new node arrives at the centre of whichever of its neighbours are already
 * placed; a node with nowhere to belong falls back to a deterministic spot around the centre.
 */
export function reconcileNodes(previous: readonly CanvasNode[], model: GraphModel, centre: Point): CanvasNode[] {
  const kept = new Map(previous.map((n) => [n.id, n]));
  const placed = new Map<string, Point>();
  for (const n of previous) placed.set(n.id, { x: n.x, y: n.y });

  const ring = seedRing(model.nodes);
  const out: CanvasNode[] = [];
  model.nodes.forEach((node, i) => {
    const radius = nodeRadius(node);
    const before = kept.get(node.id);
    if (before) {
      before.title = node.title;
      before.kind = node.kind;
      before.group = node.group;
      before.degree = node.degree;
      before.radius = radius;
      out.push(before);
      return;
    }
    const anchors: Point[] = [];
    for (const id of model.neighbours.get(node.id) ?? []) {
      const p = placed.get(id);
      if (p) anchors.push(p);
    }
    const a = angleOf(node.id);
    const seed = anchors.length
      ? {
          x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length + Math.cos(a) * 30,
          y: anchors.reduce((s, p) => s + p.y, 0) / anchors.length + Math.sin(a) * 30,
        }
      : {
          x: centre.x + Math.cos((i / Math.max(1, model.nodes.length)) * Math.PI * 2) * ring,
          y: centre.y + Math.sin((i / Math.max(1, model.nodes.length)) * Math.PI * 2) * ring,
        };
    out.push({ id: node.id, title: node.title, kind: node.kind, group: node.group, degree: node.degree, radius, x: seed.x, y: seed.y, vx: 0, vy: 0 });
  });
  return out;
}

export function linksFor(model: GraphModel): CanvasLink[] {
  return model.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, directed: e.directed }));
}

/**
 * Which of two crowding nodes a reader would rather see labelled: a hub outranks a document, a
 * node the reader is pointing at or has selected outranks any degree, otherwise the better-linked
 * node wins. Ties fall back to `id` so the choice is stable from frame to frame.
 */
function labelScore(n: Pick<CanvasNode, 'id' | 'kind' | 'degree'>, keep: ReadonlySet<string>): number {
  return (n.kind === 'hub' ? 1e9 : 0) + (keep.has(n.id) ? 1e6 : 0) + n.degree;
}

/**
 * Nodes whose label should not be drawn this frame because a higher-priority node sits close
 * enough that both labels would overlap — the backstop for whatever the layout itself has not
 * (yet) resolved, mid-drag or mid-reheat. `keep` is the hovered/selected node, if any: never
 * suppressed by a lower-degree neighbour regardless of crowding.
 */
export function suppressedLabels(nodes: readonly CanvasNode[], keep: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  const suppressed = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (gap >= (a.radius + b.radius) * 2.2) continue;
      const sa = labelScore(a, keep);
      const sb = labelScore(b, keep);
      const loser = sa !== sb ? (sa > sb ? b : a) : (a.id < b.id ? b : a);
      suppressed.add(loser.id);
    }
  }
  return suppressed;
}
