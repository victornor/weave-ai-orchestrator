/**
 * Phone bottom-bar geometry — DESIGN-CONTRACT.md §3.
 *
 * The bar carries five tabs and the Start Work button floats at its centre.
 * The button is half-sunk into the bar, so the tab row starts below the
 * button's lower edge: at 390px five equal tabs put an entry dead centre, and
 * anything the button reaches down into is an entry nobody can read or tap.
 *
 * Every length is in rem, measured from the bar's padding box (the fixed nav's
 * top border excluded), so the render and the test read the same numbers.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BarGeometry {
  height: number;
  padX: number;
  fabSize: number;
  fabTop: number;
  tabTop: number;
}

export const BAR: BarGeometry = {
  /** --bar-height, the bar chrome above the safe-area inset */
  height: 4.875,
  /** horizontal padding of the tab row */
  padX: 0.375,
  /** Start Work button diameter */
  fabSize: 3.25,
  /** button's top edge; negative, so half of it stands above the bar */
  fabTop: -1.625,
  /** first row of the tab entries — below `fabTop + fabSize` */
  tabTop: 1.75,
};

export function rem(value: number, rootPx = 16): number {
  return value * rootPx;
}

/** The Start Work button's bounds, in px, for a bar `widthPx` wide. */
export function fabRect(widthPx: number, g: BarGeometry = BAR, rootPx = 16): Rect {
  const size = rem(g.fabSize, rootPx);
  return { x: widthPx / 2 - size / 2, y: rem(g.fabTop, rootPx), w: size, h: size };
}

/** The bounds of each tab entry, in px, for a bar `widthPx` wide. */
export function tabRects(widthPx: number, count: number, g: BarGeometry = BAR, rootPx = 16): Rect[] {
  const padX = rem(g.padX, rootPx);
  const top = rem(g.tabTop, rootPx);
  const w = (widthPx - padX * 2) / count;
  const h = rem(g.height, rootPx) - top;
  return Array.from({ length: count }, (_, i) => ({ x: padX + i * w, y: top, w, h }));
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
