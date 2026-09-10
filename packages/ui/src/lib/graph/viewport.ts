/**
 * The graph's viewport: a scale and a translation, and the arithmetic that moves it.
 *
 * This is deliberately not `d3-zoom`. That module owns the element's event handling, which fights
 * React for it, drags in `d3-selection`, and is close to untestable under jsdom because it needs
 * real geometry and real event dispatch. Here the transform is a plain value and every gesture is a
 * pure function of it, so the part that can be wrong — keeping the point under the pointer still
 * while zooming, framing a set of bounds, turning two moving fingers into a scale factor — is
 * unit-tested, and only the pointer plumbing is left to the component.
 *
 * `screen = graph * k + (x, y)`.
 */

export interface ViewportTransform {
  k: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 6;
export const DEFAULT_ZOOM = 1;
export const ZOOM_STEP = 1.25;
export const IDENTITY: ViewportTransform = { k: DEFAULT_ZOOM, x: 0, y: 0 };

/** How much of a label to draw. Below `none` only hubs and the focused node are labelled. */
export type LabelDetail = 'none' | 'truncated' | 'full';

/** Labels appear at this zoom, and stop being shortened at `LABEL_FULL_ZOOM`. */
export const LABEL_TRUNCATED_ZOOM = 0.6;
export const LABEL_FULL_ZOOM = 1.4;

export function labelDetail(k: number): LabelDetail {
  if (k < LABEL_TRUNCATED_ZOOM) return 'none';
  if (k < LABEL_FULL_ZOOM) return 'truncated';
  return 'full';
}

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Graph coordinates to screen coordinates. */
export function apply(t: ViewportTransform, p: Point): Point {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}

/** Screen coordinates to graph coordinates: where in the graph a pointer is. */
export function toGraph(t: ViewportTransform, p: Point): Point {
  return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
}

/** Zoom by `factor`, keeping whatever is under `at` (in screen coordinates) under it. */
export function zoomAround(t: ViewportTransform, at: Point, factor: number): ViewportTransform {
  const k = clampZoom(t.k * factor);
  const g = toGraph(t, at);
  return { k, x: at.x - g.x * k, y: at.y - g.y * k };
}

export function panBy(t: ViewportTransform, dx: number, dy: number): ViewportTransform {
  return { k: t.k, x: t.x + dx, y: t.y + dy };
}

/** The scale two fingers just asked for, from where they were to where they are. */
export function pinchScale(from: readonly [Point, Point], to: readonly [Point, Point]): number {
  const before = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y);
  const after = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y);
  if (before < 1e-6) return 1;
  return after / before;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The bounding box of some points, or `null` for none. */
export function boundsOf(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Frame `bounds` inside `size` with a margin, centred, at a zoom inside the allowed bounds. */
export function fitTo(bounds: Bounds, size: Size, margin = 48): ViewportTransform {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const usableW = Math.max(1, size.width - margin * 2);
  const usableH = Math.max(1, size.height - margin * 2);
  const k = clampZoom(Math.min(usableW / width, usableH / height));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, x: size.width / 2 - cx * k, y: size.height / 2 - cy * k };
}

/**
 * Opening / reset: never zoom out past `DEFAULT_ZOOM`, so titles stay visible. A graph that
 * already fits at a higher scale still uses that fitted scale.
 */
export function defaultView(bounds: Bounds, size: Size, margin = 48): ViewportTransform {
  const fitted = fitTo(bounds, size, margin);
  const k = Math.max(fitted.k, DEFAULT_ZOOM);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, x: size.width / 2 - cx * k, y: size.height / 2 - cy * k };
}

/** Centre `at` in the viewport without changing the zoom: how the view follows a focused node. */
export function centreOn(t: ViewportTransform, at: Point, size: Size): ViewportTransform {
  return { k: t.k, x: size.width / 2 - at.x * t.k, y: size.height / 2 - at.y * t.k };
}

/** The transform as the `transform` attribute of the group everything is drawn in. */
export function toSvg(t: ViewportTransform): string {
  return `translate(${t.x} ${t.y}) scale(${t.k})`;
}
