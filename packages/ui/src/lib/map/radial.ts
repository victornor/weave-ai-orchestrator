/**
 * Radial tree layout for the global Map (VS-192): every node in `MapModel` already has exactly
 * one parent edge (the model is a tree, not a general graph), so a leaf-weighted angular
 * partition is enough — no `d3-hierarchy` needed. See design.md §1.
 */
import type { MapModel } from './model';

export interface RadialNode {
  id: string;
  depth: number;
  angle: number;
  radius: number;
  x: number;
  y: number;
}

export type RadialLayout = ReadonlyMap<string, RadialNode>;

/** Fixed ring radius per depth (graph units); depth 0 is the undrawn instance root. */
const RING_RADIUS = [0, 96, 176, 256, 336];
/** Beyond the table, each further depth extends the ring by this much. */
const RING_STEP = 80;

/** Radians between adjacent workspace wedges, so two workspaces are never visually adjacent. */
const WORKSPACE_GAP = 0.12;
/** Floor on a single leaf's share of its parent's span, so a bushy sibling still yields it room. */
const MIN_LEAF_ANGLE = 0.05;

function ringRadius(depth: number): number {
  if (depth < RING_RADIUS.length) return RING_RADIUS[depth]!;
  return RING_RADIUS[RING_RADIUS.length - 1]! + (depth - (RING_RADIUS.length - 1)) * RING_STEP;
}

function childrenByParent(model: MapModel): Map<string, string[]> {
  const order = new Map(model.nodes.map((n, i) => [n.id, i]));
  const map = new Map<string, string[]>();
  for (const e of model.edges) {
    const list = map.get(e.source) ?? [];
    list.push(e.target);
    map.set(e.source, list);
  }
  // Preserve buildMapModel's own push order (projects, then roles, then tickets, then
  // knowledge) for deterministic left-to-right placement.
  for (const list of map.values()) list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return map;
}

/** Build the radial layout: every node's angle and fixed per-depth radius. */
export function layoutRadial(model: MapModel): RadialLayout {
  const out = new Map<string, RadialNode>();
  if (!model.nodes.length) return out;

  const children = childrenByParent(model);
  const leafCountCache = new Map<string, number>();
  const leafCount = (id: string): number => {
    const cached = leafCountCache.get(id);
    if (cached !== undefined) return cached;
    const kids = children.get(id) ?? [];
    const n = kids.length === 0 ? 1 : kids.reduce((sum, c) => sum + leafCount(c), 0);
    leafCountCache.set(id, n);
    return n;
  };

  const place = (id: string, depth: number, angleStart: number, angleEnd: number): void => {
    const angle = (angleStart + angleEnd) / 2;
    const radius = ringRadius(depth);
    out.set(id, { id, depth, angle, radius, x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    const kids = children.get(id) ?? [];
    if (!kids.length) return;
    const span = angleEnd - angleStart;
    const totalLeaves = kids.reduce((sum, c) => sum + leafCount(c), 0);
    // Each child is floored at a minimum share (capped at an equal split so floors never
    // overflow the span), then the remainder is distributed proportional to leaf count — a
    // bushy child gets more room than a lone leaf, but nothing collapses to zero width.
    const floors = kids.map((c) => Math.min(span / kids.length, MIN_LEAF_ANGLE * leafCount(c)));
    const floorSum = floors.reduce((a, b) => a + b, 0);
    const remaining = Math.max(0, span - floorSum);
    let cursor = angleStart;
    kids.forEach((c, i) => {
      const extra = totalLeaves > 0 ? (remaining * leafCount(c)) / totalLeaves : 0;
      const childSpan = (floors[i] ?? 0) + extra;
      place(c, depth + 1, cursor, cursor + childSpan);
      cursor += childSpan;
    });
  };

  const workspaces = model.nodes.filter((n) => n.kind === 'workspace').map((n) => n.id);
  const totalWsLeaves = workspaces.reduce((sum, id) => sum + leafCount(id), 0) || 1;
  const usable = Math.max(0, Math.PI * 2 - WORKSPACE_GAP * workspaces.length);
  let cursor = 0;
  for (const id of workspaces) {
    const span = usable * (leafCount(id) / totalWsLeaves);
    place(id, 1, cursor, cursor + span);
    cursor += span + WORKSPACE_GAP;
  }

  return out;
}

/**
 * The smallest on-screen gap between two sibling nodes at each depth, from adjacent-by-angle
 * children of the same parent. Used to cap drift amplitude so it can never close the gap between
 * two siblings (design.md §2).
 */
export function minSiblingGapByDepth(model: MapModel, layout: RadialLayout): ReadonlyMap<number, number> {
  const gaps = new Map<number, number>();
  const children = childrenByParent(model);
  for (const kids of children.values()) {
    if (kids.length < 2) continue;
    const nodes = kids.map((id) => layout.get(id)).filter((n): n is RadialNode => Boolean(n));
    nodes.sort((a, b) => a.angle - b.angle);
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const prev = gaps.get(a.depth);
      if (prev === undefined || dist < prev) gaps.set(a.depth, dist);
    }
  }
  return gaps;
}
