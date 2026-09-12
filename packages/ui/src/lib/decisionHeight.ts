/**
 * How tall the weave chat's pinned decision region is, remembered per device (VS-94).
 *
 * The region was capped at a fixed share of the app height, which is a guess made once for every
 * reader and every screen: a long plan approval is read three lines at a time, while a short
 * question on a tall window leaves the cap unused. The human drags its top edge instead, and what
 * they chose is a view preference rather than workspace state — so it lives in `localStorage`
 * beside `lib/barVisibility.ts`, and every access is guarded the same way, because a browser that
 * refuses storage must still render the chat and must still resize it for the session.
 *
 * One key for the whole app rather than one per workspace: there is nothing workspace-specific
 * about how tall a reader wants their cards, and the height is meant to survive switching between
 * them. (`lib/hiddenDecisions.ts` is per-workspace because *which* decisions are hidden is.)
 *
 * A pixel height, not a share of the viewport. A drag is measured in pixels, and the
 * viewport-relative behaviour comes from the clamps being derived from live geometry instead: a
 * height too large for the viewport the keyboard left behind is capped for as long as that lasts,
 * and is still the chosen height once it closes.
 */

const KEY = 'conductor.decisions.height';

/**
 * The smallest the region may be: enough for the topmost card's heading and the row of actions that
 * answers it, so shrinking it can never hide the thing it exists to show.
 */
export const MIN_PX = 144;

/** Kept above the region for the conversation, so resizing can never leave the list a sliver. */
export const MIN_LIST_PX = 120;

/** One arrow-key press. Coarse enough to cross the range in a few presses, fine enough to aim. */
export const STEP_PX = 24;

/** The region's geometry inside the app shell, read live rather than assumed. */
export interface HeightBounds {
  /** The region's bottom edge, which the composer below it holds still during a drag. */
  sectionBottom: number;
  /** The top of the chat page inside `.ac-app`, which is sized by `--ac-app-h`. */
  pageTop: number;
}

/**
 * The largest the region may be: everything between the top of the app and the region's bottom
 * edge, less the strip of conversation that must stay visible. Floored at `MIN_PX` so a viewport
 * too small to honour both constants yields a degenerate range rather than an inverted one.
 */
export function maxHeight({ sectionBottom, pageTop }: HeightBounds): number {
  return Math.max(MIN_PX, Math.round(sectionBottom - pageTop - MIN_LIST_PX));
}

/** The one definition of a legal height, used by the drag, by the keyboard and by the render. */
export function clampHeight(px: number, bounds: HeightBounds): number {
  return Math.min(Math.max(Math.round(px), MIN_PX), maxHeight(bounds));
}

/**
 * The chosen height, or `null` for "never resized" — which is a different rendering, not a default
 * number: without one the region is content-sized under today's cap. Anything unreadable or not a
 * positive finite number reads as `null`, so a stale or corrupt value is today's behaviour.
 */
export function readDecisionHeight(): number | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const px = Number(raw);
  return Number.isFinite(px) && px > 0 ? Math.round(px) : null;
}

/** `null` forgets the choice outright, so the region goes back to behaving as it never was resized. */
export function writeDecisionHeight(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(Math.round(px)));
  } catch {
    /* private mode: the session honours the choice, the device just does not remember it */
  }
}
