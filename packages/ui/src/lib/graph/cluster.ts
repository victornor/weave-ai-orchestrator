/**
 * A weak pull towards each group's running centroid, which is what draws a project's pages into a
 * visible cluster once nothing else (a hull, in the previous renderer) draws a boundary around it —
 * see `openspec/changes/vs-280-rebuild-the-knowledge-graph-on-a-canvas/design.md` Decision 3.
 * Ported unchanged in behaviour from the old `lib/graph/simulation.ts`'s `clusterForce`; ownership
 * moves here because it is registered directly against `react-force-graph-2d`'s own `d3-force-3d`
 * simulation via `d3Force('cluster', clusterForce(strength))` rather than a hand-rolled one.
 *
 * Has to be a custom force rather than `forceX`/`forceY` with an accessor, because d3 evaluates
 * those once at initialisation and the centroid moves every tick.
 *
 * The pull eases as a group grows (divided by the square root of its size): held at a flat
 * `strength` regardless of size, a group with many siblings gets pulled toward one centroid harder
 * than collision can resolve, and the group collapses into an overlapping clump. A small group
 * still clusters tightly; a large one clusters loosely enough that collision keeps up.
 */

export interface ClusterableNode {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  group: string;
}

export interface ClusterForce {
  (alpha: number): void;
  initialize(nodes: ClusterableNode[]): void;
}

/**
 * A weak pull toward one shared point, replacing `react-force-graph-2d`'s own default `center`
 * force (`d3ForceCenter`, which recentres the whole mean every tick and so drags every node
 * whenever one of them is pinned or dragged — the same reason the pre-VS-280 renderer used this
 * shape of force instead). Needed because `clusterForce` alone only pulls each group toward *its
 * own* centroid: nothing stops different groups' centroids from drifting apart from each other
 * over unbounded distance, and confirmed doing exactly that in manual verification before this was
 * added — most of a synthetic 226-node graph drifted off-screen within a few seconds.
 */
export function centeringForce(cx: number, cy: number, strength: number): ClusterForce {
  let nodes: ClusterableNode[] = [];
  const force = ((alpha: number): void => {
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) + (cx - n.x) * strength * alpha;
      n.vy = (n.vy ?? 0) + (cy - n.y) * strength * alpha;
    }
  }) as ClusterForce;
  force.initialize = (ns: ClusterableNode[]): void => {
    nodes = ns;
  };
  return force;
}

export function clusterForce(strength: number): ClusterForce {
  let nodes: ClusterableNode[] = [];
  const force = ((alpha: number): void => {
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
  }) as ClusterForce;
  force.initialize = (ns: ClusterableNode[]): void => {
    nodes = ns;
  };
  return force;
}
