/**
 * The device-remembered V2 rail state. Kept out of V1's `wsExpansion`/`barVisibility` so the two
 * versions never read each other's storage.
 */
const KEY = 'weave.v2.rail';

/** Where V2's Global Chats remembers its pane layout; V1's own key is left to V1. */
export const V2_CHATS_LAYOUT_KEY = 'weave.v2.chats.layout';

export function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function writeRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* private mode */
  }
}

/** The Live floor's cards per row (VS-350). */
const LIVE_COLUMNS_KEY = 'weave.v2.live.columns';
export const LIVE_COLUMNS_DEFAULT = 2;
export const LIVE_COLUMNS_MIN = 1;
export const LIVE_COLUMNS_MAX = 4;

/** Cards per row, clamped to the control's range; an absent or junk value falls back to the default. */
export function readLiveColumns(): number {
  try {
    const raw = Number(localStorage.getItem(LIVE_COLUMNS_KEY));
    if (!Number.isFinite(raw) || raw < LIVE_COLUMNS_MIN) return LIVE_COLUMNS_DEFAULT;
    return Math.min(LIVE_COLUMNS_MAX, Math.round(raw));
  } catch {
    return LIVE_COLUMNS_DEFAULT;
  }
}

export function writeLiveColumns(columns: number): void {
  try {
    const clamped = Math.min(LIVE_COLUMNS_MAX, Math.max(LIVE_COLUMNS_MIN, Math.round(columns)));
    localStorage.setItem(LIVE_COLUMNS_KEY, String(clamped));
  } catch {
    /* private mode */
  }
}

/** The Live floor's shared tile-feed height (VS-372), remembered beside the cards per row. */
const LIVE_HEIGHT_KEY = 'weave.v2.live.height';

/** The smallest tile feed: the card's header context and a few trace lines. */
export const LIVE_HEIGHT_MIN = 140;

/** Tiles may take most of the viewport; the rest keeps the toolbar and the page in view. */
export const LIVE_HEIGHT_VIEWPORT_SHARE = 0.85;

/** One arrow-key press: coarse enough to cross the range, fine enough to aim. */
export const LIVE_HEIGHT_STEP = 24;

/** The tallest a tile may be on a viewport this tall, floored so the range never inverts. */
export function maxLiveHeight(viewportHeight: number): number {
  return Math.max(LIVE_HEIGHT_MIN, Math.round(viewportHeight * LIVE_HEIGHT_VIEWPORT_SHARE));
}

/** The one definition of a legal tile height, used by the drag, by the keyboard and by the render. */
export function clampLiveHeight(px: number, viewportHeight: number): number {
  return Math.min(Math.max(Math.round(px), LIVE_HEIGHT_MIN), maxLiveHeight(viewportHeight));
}

/**
 * The chosen height, or `null` for "still following the per-row ladder" — a different rendering,
 * not a default number. Anything unreadable or not a positive finite number reads as `null`.
 */
export function readLiveHeight(): number | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LIVE_HEIGHT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const px = Number(raw);
  return Number.isFinite(px) && px > 0 ? Math.round(px) : null;
}

/** `null` forgets the choice outright, so the per-row ladder applies again. */
export function writeLiveHeight(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(LIVE_HEIGHT_KEY);
    else localStorage.setItem(LIVE_HEIGHT_KEY, String(Math.round(px)));
  } catch {
    /* private mode */
  }
}
