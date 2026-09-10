/**
 * The live layout: a `d3-force` simulation that keeps settling, reheats when the graph is
 * disturbed, and carries its node positions across a refetch so the view animates instead of
 * jumping.
 *
 * `d3-force` is here for two things the hand-written layout it replaces could not do. Its
 * many-body force is Barnes–Hut, so 200 nodes cost roughly n log n a tick rather than n²; and its
 * alpha model already means "warm up on a disturbance, cool down to rest", which is the whole of
 * "the graph keeps settling" and all of what dragging a node needs.
 *
 * Nothing in here touches the DOM or React. The component subscribes to `onTick` and writes the
 * positions out itself; these node objects are the single source of truth for where things are.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphModel, GraphNode, GraphNodeKind } from './model';
import type { Point, Size } from './viewport';

export interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: GraphNodeKind;
  group: string;
  degree: number;
  tokens: number;
  /** Drawn radius in graph units; the collide force and the renderer must agree on it. */
  radius: number;
  x: number;
  y: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  directed: boolean;
}

/** The alpha a disturbance reheats to: warm enough to adjust, cool enough not to re-form. */
export const WARM_ALPHA = 0.3;
/** Ticks a synchronous settle runs. Enough for alpha to decay from 1 to d3's resting minimum. */
export const SETTLE_TICKS = 320;

const CHIP_H_DOC = 24;
const CHIP_H_HUB = 28;
const CHIP_PAD_X = 20;
const CHIP_CHAR_W = 6.5;
const CHIP_ACCENT = 3;

/** Labeled-chip dimensions in graph units. Width follows a truncated title; hubs are taller. */
export function chipSize(node: Pick<GraphNode, 'kind' | 'degree' | 'title'>): { width: number; height: number } {
  const height = node.kind === 'hub' ? CHIP_H_HUB : CHIP_H_DOC;
  const chars = Math.min(26, Math.max(8, node.title.length));
  const grow = Math.min(20, node.degree * 2);
  return { width: CHIP_PAD_X + CHIP_ACCENT + chars * CHIP_CHAR_W + grow, height };
}

/** Collide radius that covers the chip, so neighbouring labels do not overlap. */
export function nodeRadius(node: Pick<GraphNode, 'kind' | 'degree' | 'title'>): number {
  const { width, height } = chipSize(node);
  return Math.max(width, height) / 2;
}

/** Whether two chips' drawn rectangles overlap — the standard axis-aligned-box test. */
export function chipsOverlap(a: SimNode, b: SimNode): boolean {
  const wa = chipSize(a);
  const wb = chipSize(b);
  return Math.abs(a.x - b.x) < (wa.width + wb.width) / 2 && Math.abs(a.y - b.y) < (wa.height + wb.height) / 2;
}

/**
 * Which of two overlapping chips a reader would rather see: a hub outranks a document by more
 * than any degree difference could close, so a hub is never the one suppressed by a document
 * sharing its position; a node the reader is pointing at or has selected outranks any degree;
 * otherwise the better-linked node wins. Ties (equal on every count) fall back to `id` so the
 * choice is stable from tick to tick rather than flickering.
 */
function labelScore(n: Pick<SimNode, 'id' | 'kind' | 'degree'>, keep: ReadonlySet<string>): number {
  return (n.kind === 'hub' ? 1e9 : 0) + (keep.has(n.id) ? 1e6 : 0) + n.degree;
}

/**
 * Chips whose label should not be drawn this tick because a higher-priority chip overlaps them
 * — the backstop for whatever crowding the layout itself does not resolve (VS-193's "labels
 * never overlap" requirement). `keep` is the hovered/selected node, if any: never suppressed by
 * a lower-degree neighbour regardless of layout.
 */
export function suppressedLabels(nodes: readonly SimNode[], keep: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  const suppressed = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (!chipsOverlap(a, b)) continue;
      const sa = labelScore(a, keep);
      const sb = labelScore(b, keep);
      const loser = sa !== sb ? (sa > sb ? b : a) : (a.id < b.id ? b : a);
      suppressed.add(loser.id);
    }
  }
  return suppressed;
}

/**
 * A ring wide enough that a full graph of brand-new nodes — the case on every first load,
 * since nothing is in `previous` yet — does not start seeded on top of itself. A flat
 * `40 + n*1.6` (its predecessor) put 30+ real chips inside a ~95-unit-radius ring barely wider
 * than one of them: fixed at VS-193 after finding ~18% of chip pairs already overlapping at
 * seed time, before the layout had ticked once, on a graph this project's own knowledge base
 * shape. Sized from the chips' own footprint instead, so the ring scales with what is actually
 * being placed on it rather than a constant tuned for some other graph.
 */
function seedRing(nodes: readonly Pick<GraphNode, 'kind' | 'degree' | 'title'>[]): number {
  if (nodes.length === 0) return 40;
  const totalDiameter = nodes.reduce((sum, n) => sum + nodeRadius(n) * 2, 0);
  // Circumference for every chip side by side around the ring, plus a third again for breathing
  // room — forces pull the layout in from here, so a generous seed shortens the visible unscramble
  // rather than growing the settled graph.
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
 * Carry a layout across a data change.
 *
 * Nodes that survive keep their position, their velocity and their pin, so an unchanged refetch is
 * a no-op the reader cannot see. A node that is new arrives at the centre of whichever of its
 * neighbours are already placed — so it enters where it belongs rather than flying in from a ring —
 * and only a node with nowhere to belong falls back to a deterministic spot around the centre.
 */
export function reconcileNodes(previous: readonly SimNode[], model: GraphModel, centre: Point): SimNode[] {
  const kept = new Map(previous.map((n) => [n.id, n]));
  const out: SimNode[] = [];
  const placed = new Map<string, Point>();
  for (const n of previous) placed.set(n.id, { x: n.x, y: n.y });

  const ring = seedRing(model.nodes);
  model.nodes.forEach((node, i) => {
    const before = kept.get(node.id);
    if (before) {
      out.push(Object.assign(before, {
        title: node.title,
        kind: node.kind,
        group: node.group,
        degree: node.degree,
        tokens: node.tokens,
        radius: nodeRadius(node),
      }));
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
    out.push({
      id: node.id,
      title: node.title,
      kind: node.kind,
      group: node.group,
      degree: node.degree,
      tokens: node.tokens,
      radius: nodeRadius(node),
      x: seed.x,
      y: seed.y,
      vx: 0,
      vy: 0,
    });
  });
  return out;
}

/**
 * A weak pull towards each group's running centroid, which is what draws a project's pages into a
 * cluster the hull can be thrown around. It has to be a custom force rather than `forceX`/`forceY`
 * with an accessor, because d3 evaluates those once at initialisation and the centroid moves every
 * tick.
 *
 * The pull eases as a group grows (divided by the square root of its size): held at a flat
 * `strength` regardless of size, a group with many siblings — pages that share only a hub, with no
 * edge holding them apart from each other — gets pulled toward one centroid harder than two
 * `forceCollide` iterations a tick can resolve, and the group collapses into an overlapping clump
 * whose opaque chips paint over one another (see `design.md` for VS-193). A small group still
 * clusters tightly; a large one clusters loosely enough that collision keeps up.
 */
function clusterForce(strength: number): Force<SimNode, undefined> {
  let nodes: SimNode[] = [];
  const force = (alpha: number): void => {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const n of nodes) {
      const s = sums.get(n.group) ?? { x: 0, y: 0, n: 0 };
      s.x += n.x;
      s.y += n.y;
      s.n += 1;
      sums.set(n.group, s);
    }
    for (const n of nodes) {
      const s = sums.get(n.group)!;
      const k = (strength / Math.sqrt(s.n)) * alpha;
      n.vx = (n.vx ?? 0) + (s.x / s.n - n.x) * k;
      n.vy = (n.vy ?? 0) + (s.y / s.n - n.y) * k;
    }
  };
  force.initialize = (ns: SimNode[]): void => {
    nodes = ns;
  };
  return force;
}

export interface GraphSimulation {
  nodes(): SimNode[];
  links(): SimLink[];
  node(id: string): SimNode | undefined;
  /** Reconcile against new data or a new viewport size and reheat. */
  update(model: GraphModel, size: Size): void;
  onTick(fn: () => void): () => void;
  /** Reheat and run — or, when the reader asked for reduced motion, settle in one pass. */
  start(alpha?: number): void;
  stop(): void;
  isRunning(): boolean;
  /** Run the layout to rest synchronously, scheduling no frames. */
  settle(iterations?: number, alpha?: number): void;
  pin(id: string): void;
  unpin(id: string): void;
  isPinned(id: string): boolean;
  pinned(): ReadonlySet<string>;
  /** Hold a node at a point while a pointer drags it. */
  drag(id: string, x: number, y: number): void;
  endDrag(id: string): void;
  destroy(): void;
}

export interface SimulationOptions {
  /** False when the reader prefers reduced motion: everything settles in one step, no frames. */
  animated: boolean;
}

export function createSimulation(model: GraphModel, size: Size, options: SimulationOptions): GraphSimulation {
  const centre = { x: size.width / 2, y: size.height / 2 };
  let nodes = reconcileNodes([], model, centre);
  let links = linksFor(model, nodes);
  const listeners = new Set<() => void>();
  const pins = new Set<string>();
  let running = false;
  let animated = options.animated;

  const emit = (): void => {
    for (const fn of listeners) fn();
  };

  const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode, SimLink>(nodes)
    .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(linkDistance).strength(0.5))
    .force('charge', forceManyBody<SimNode>().strength(-420).distanceMax(800))
    // More margin and more relaxation passes than d3's defaults: with many same-group siblings
    // converging on one centroid at once (see `clusterForce`), two iterations were not enough
    // to keep their chips apart before the layout settled.
    .force('collide', forceCollide<SimNode>((d) => d.radius + 20).iterations(4))
    // A pull towards the centre rather than `forceCenter`, which recentres the whole mean each tick
    // and so drags every node whenever one of them is pinned.
    .force('x', forceX<SimNode>(centre.x).strength(0.02))
    .force('y', forceY<SimNode>(centre.y).strength(0.02))
    .force('cluster', clusterForce(0.08))
    .on('tick', emit)
    .on('end', () => {
      running = false;
    })
    .stop();

  const applyPins = (): void => {
    for (const n of nodes) {
      if (pins.has(n.id)) {
        n.fx = n.x;
        n.fy = n.y;
      }
    }
  };

  const restart = (alpha: number): void => {
    if (!animated) {
      settle(SETTLE_TICKS, alpha);
      return;
    }
    running = true;
    sim.alpha(Math.max(sim.alpha(), alpha)).restart();
  };

  function settle(iterations = SETTLE_TICKS, alpha = WARM_ALPHA): void {
    sim.stop();
    running = false;
    sim.alpha(Math.max(alpha, sim.alphaMin()));
    sim.tick(iterations);
    sim.alpha(0);
    emit();
  }

  return {
    nodes: () => nodes,
    links: () => links,
    node: (id) => nodes.find((n) => n.id === id),

    update(next, nextSize) {
      const c = { x: nextSize.width / 2, y: nextSize.height / 2 };
      nodes = reconcileNodes(nodes, next, c);
      links = linksFor(next, nodes);
      for (const id of [...pins]) if (!next.byId.has(id)) pins.delete(id);
      applyPins();
      sim.nodes(nodes);
      (sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).links(links);
      (sim.force('x') as ReturnType<typeof forceX<SimNode>>).x(c.x);
      (sim.force('y') as ReturnType<typeof forceY<SimNode>>).y(c.y);
      restart(WARM_ALPHA);
    },

    onTick(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    start(alpha = 1) {
      restart(alpha);
    },

    stop() {
      sim.stop();
      running = false;
    },

    isRunning: () => running,
    settle,

    pin(id) {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      pins.add(id);
      n.fx = n.x;
      n.fy = n.y;
      emit();
    },

    unpin(id) {
      pins.delete(id);
      const n = nodes.find((x) => x.id === id);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      restart(WARM_ALPHA);
    },

    isPinned: (id) => pins.has(id),
    pinned: () => pins,

    drag(id, x, y) {
      const n = nodes.find((v) => v.id === id);
      if (!n) return;
      n.fx = x;
      n.fy = y;
      n.x = x;
      n.y = y;
      // Draw the node under the pointer now: the reheated simulation's own next tick is a frame
      // away, and with reduced motion there is no next tick until the drag ends.
      emit();
      if (animated) {
        running = true;
        sim.alphaTarget(WARM_ALPHA).restart();
      }
    },

    endDrag(id) {
      const n = nodes.find((v) => v.id === id);
      if (n && !pins.has(id)) {
        n.fx = null;
        n.fy = null;
      }
      if (animated) {
        sim.alphaTarget(0);
        restart(WARM_ALPHA);
      } else {
        settle();
      }
    },

    destroy() {
      sim.on('tick', null);
      sim.on('end', null);
      sim.stop();
      listeners.clear();
      running = false;
      animated = false;
    },
  };
}

function linkDistance(link: SimLink): number {
  const s = typeof link.source === 'object' ? link.source.radius : 8;
  const t = typeof link.target === 'object' ? link.target.radius : 8;
  return 120 + s + t;
}

function linksFor(model: GraphModel, nodes: readonly SimNode[]): SimLink[] {
  const known = new Set(nodes.map((n) => n.id));
  return model.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, directed: e.directed }));
}
