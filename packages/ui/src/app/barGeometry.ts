/**
 * Phone bottom-bar geometry — DESIGN-CONTRACT.md §3.
 *
 * The bar carries five tabs and nothing else. It used to hold a Start Work
 * button half-sunk into its top edge, which is why the tab row began well
 * below the bar's own padding; VS-81 removed the button, so the row starts at
 * that padding and each tab centres its glyph and label in what is left.
 *
 * With the button gone, so is the reason the bar was 78px tall. The label is
 * already the smallest type token and the glyph is 16px, so what remained was
 * the clearance an entry needed from something that is no longer there: VS-80
 * takes the chrome down to 56px, which still leaves every tab a 48px target.
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
  handle: number;
  padX: number;
  tabTop: number;
}

export const BAR: BarGeometry = {
  /** --bar-height, the bar chrome above the safe-area inset */
  height: 3.5,
  /** --bar-handle, the slim strip the bar collapses to when it is hidden */
  handle: 1.5,
  /** horizontal padding of the tab row */
  padX: 0.375,
  /** first row of the tab entries — the bar's own top padding */
  tabTop: 0.5,
};

export function rem(value: number, rootPx = 16): number {
  return value * rootPx;
}

/** The bounds of each tab entry, in px, for a bar `widthPx` wide. */
export function tabRects(widthPx: number, count: number, g: BarGeometry = BAR, rootPx = 16): Rect[] {
  const padX = rem(g.padX, rootPx);
  const top = rem(g.tabTop, rootPx);
  const w = (widthPx - padX * 2) / count;
  const h = rem(g.height, rootPx) - top;
  return Array.from({ length: count }, (_, i) => ({ x: padX + i * w, y: top, w, h }));
}
