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

  const ring = 40 + model.nodes.length * 1.6;
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
    const k = strength * alpha;
    for (const n of nodes) {
      const s = sums.get(n.group)!;
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
    .force('collide', forceCollide<SimNode>((d) => d.radius + 16).iterations(2))
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
