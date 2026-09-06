/**
 * The translucent region drawn behind each project's nodes: a padded convex hull of wherever that
 * project's pages currently are, recomputed on the tick that moves them.
 *
 * The padding is a dilation rather than a push away from the centroid, because a group is often two
 * nodes or a row of collinear ones, and offsetting those from their own centre gives a degenerate
 * sliver. Growing every point into a small octagon first and hulling the result gives a sane region
 * for any arrangement, including a single pair sitting on top of each other.
 */

export interface Point {
  x: number;
  y: number;
}

/** Andrew's monotone chain. Returns the hull counter-clockwise, without repeating the first point. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  const unique = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);
  if (unique.length < 3) return unique;

  const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: Point[]): Point[] => {
    const out: Point[] = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(unique), ...half([...unique].reverse())];
}

const OCTAGON: readonly Point[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
});

/**
 * The cluster region for a group's node positions, as an SVG path, or `null` for fewer than the two
 * nodes the spec asks for. Corners are rounded by drawing through the edge midpoints, so the region
 * reads as a blob rather than a polygon.
 */
export function hullPath(points: readonly Point[], pad: number): string | null {
  if (points.length < 2) return null;
  const grown: Point[] = [];
  for (const p of points) for (const o of OCTAGON) grown.push({ x: p.x + o.x * pad, y: p.y + o.y * pad });
  const hull = convexHull(grown);
  if (hull.length < 3) return null;

  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(hull[hull.length - 1]!, hull[0]!);
  let d = `M${round(start.x)} ${round(start.y)}`;
  for (let i = 0; i < hull.length; i++) {
    const corner = hull[i]!;
    const next = mid(corner, hull[(i + 1) % hull.length]!);
    d += `Q${round(corner.x)} ${round(corner.y)} ${round(next.x)} ${round(next.y)}`;
  }
  return `${d}Z`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
