/**
 * How large a Live-page worker cell is, remembered for the tab session (VS-164).
 *
 * Size is integer CSS-grid spans, not pixels — a wrapping grid reflows around spans, and jsdom
 * cannot see geometry. Spans are fine-grained tracks (VS-206): `GRANULARITY` tracks per old
 * "slot". The map is per workspace and per worker; workers are disposable, so this lives in
 * sessionStorage (a durable store would accumulate dead ids). A browser that refuses storage still
 * resizes for the session.
 */

export interface CellSize {
  cols: number;
  rows: number;
  expanded?: boolean;
}

/** Sub-tracks per old "slot" (a column tier or a row step) — see design.md in VS-206's change. */
export const GRANULARITY = 4;

export const ROWS_MAX = GRANULARITY * 2;

const keyOf = (wsId: string): string => `conductor.live.cellSizes.${wsId}`;

export function columnCount(minSm: boolean, minXl: boolean): number {
  if (minXl) return 3 * GRANULARITY;
  if (minSm) return 2 * GRANULARITY;
  return 1 * GRANULARITY;
}

/**
 * The equal slot a never-resized cell occupies (VS-324): half the grid's width on `sm` and `xl`
 * (`desktop === true` at both — `desktop` is exactly the caller's `minSm`), the full grid's width
 * on the one-column phone layout (`desktop === false`). `colsMax` is `8` at `sm` and `12` at `xl`,
 * so this gives `4` and `6` respectively without any per-breakpoint branching here; `4` at phone
 * (`colsMax` itself) keeps one cell per row. Rows are unaffected — only the default width changes.
 */
export function defaultSize(desktop: boolean, colsMax: number): CellSize {
  const cols = desktop ? Math.max(1, Math.round(colsMax / 2)) : colsMax;
  return { cols, rows: GRANULARITY };
}

export function clampSize(size: CellSize, colsMax: number): CellSize {
  const max = Math.max(1, Math.round(colsMax) || 1);
  const cols = Math.min(Math.max(Math.round(size.cols) || 1, 1), max);
  const expanded = size.expanded === true;
  const rows = expanded ? ROWS_MAX : Math.min(Math.max(Math.round(size.rows) || 1, 1), ROWS_MAX);
  return expanded ? { cols, rows, expanded: true } : { cols, rows };
}

export function sameSize(a: CellSize, b: CellSize): boolean {
  return a.cols === b.cols && a.rows === b.rows && Boolean(a.expanded) === Boolean(b.expanded);
}

export function isDefaultSize(size: CellSize, desktop: boolean, colsMax: number): boolean {
  const d = defaultSize(desktop, colsMax);
  return size.cols === d.cols && size.rows === d.rows && !size.expanded;
}

export function snapSize(
  start: CellSize,
  dx: number,
  dy: number,
  unitW: number,
  unitH: number,
  colsMax: number,
): CellSize {
  const cols = unitW > 0 ? start.cols + Math.round(dx / unitW) : start.cols;
  const rows = unitH > 0 ? start.rows + Math.round(dy / unitH) : start.rows;
  return clampSize({ cols, rows }, colsMax);
}

function parseSize(value: unknown): CellSize | null {
  if (value === null || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const cols = Number(rec.cols);
  const rows = Number(rec.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return null;
  const expanded = rec.expanded === true;
  return expanded
    ? { cols: Math.round(cols), rows: Math.round(rows), expanded: true }
    : { cols: Math.round(cols), rows: Math.round(rows) };
}

export function readLiveCellSizes(wsId: string): Record<string, CellSize> {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(keyOf(wsId));
  } catch {
    return {};
  }
  if (raw === null || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CellSize> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const size = parseSize(value);
      if (size) out[id] = size;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLiveCellSizes(
  wsId: string,
  map: Record<string, CellSize>,
  liveIds: readonly string[],
  desktop: boolean,
  colsMax: number,
): Record<string, CellSize> {
  const keep: Record<string, CellSize> = {};
  for (const id of liveIds) {
    const size = map[id];
    if (!size || isDefaultSize(size, desktop, colsMax)) continue;
    keep[id] = size;
  }
  try {
    if (Object.keys(keep).length === 0) sessionStorage.removeItem(keyOf(wsId));
    else sessionStorage.setItem(keyOf(wsId), JSON.stringify(keep));
  } catch {
    /* private mode: the session honours the choice, the tab just does not remember it */
  }
  return keep;
}

export function sizeOf(map: Record<string, CellSize>, workerId: string, desktop: boolean, colsMax: number): CellSize {
  return clampSize(map[workerId] ?? defaultSize(desktop, colsMax), colsMax);
}
