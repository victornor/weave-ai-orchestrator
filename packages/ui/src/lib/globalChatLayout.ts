/**
 * The global Chats page's pane layout, remembered per browser (VS-336).
 *
 * Order, each pane's width and each pane's collapsed state are the whole model; everything about
 * dragging, keyboard resizing, collapsing and reordering is a pure function over it, so the route
 * only wires events to these and the tests can run without jsdom measuring a flex row. Widths are
 * positive flex-grow *weights*, not pixels: the browser's flex algorithm turns them into widths
 * proportionally, so a layout saved on a wide screen still reads on a narrow one. The one thing a
 * pointer drag needs from the DOM — the row's pixel width — is read at drag start by the component;
 * nothing here needs geometry.
 */
export interface GlobalChatLayout {
  /** Workspace ids, left to right. */
  order: string[];
  /** Flex-grow weight per workspace id; a positive finite number, defaulting to `DEFAULT_WEIGHT`. */
  widths: Record<string, number>;
  /** Workspace ids collapsed to a sliver. */
  collapsed: Record<string, boolean>;
}

/** The weight a never-resized pane carries; all equal weights share the row evenly. */
export const DEFAULT_WEIGHT = 1;

/** A resized pair keeps at least this share of its combined weight on each side. */
export const MIN_SPLIT = 0.2;

const KEY = 'conductor.globalChats.layout';

/** V1's storage key, and the default for a caller that does not name its own (V2 uses its own so the
 *  two versions never read each other's layout). */
export const GLOBAL_CHAT_LAYOUT_KEY = KEY;

export function emptyLayout(): GlobalChatLayout {
  return { order: [], widths: {}, collapsed: {} };
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function weightOf(widths: Record<string, number>, id: string): number {
  const weight = widths[id];
  return isPositiveNumber(weight) ? weight : DEFAULT_WEIGHT;
}

export function isCollapsed(layout: GlobalChatLayout, id: string): boolean {
  return layout.collapsed[id] === true;
}

export function expandedIds(layout: GlobalChatLayout): string[] {
  return layout.order.filter((id) => !isCollapsed(layout, id));
}

/** A pane can be collapsed only while it is expanded and some other pane is still expanded. */
export function canCollapse(layout: GlobalChatLayout, id: string): boolean {
  return !isCollapsed(layout, id) && expandedIds(layout).length > 1;
}

export function sameLayout(a: GlobalChatLayout, b: GlobalChatLayout): boolean {
  if (a.order.length !== b.order.length) return false;
  for (let i = 0; i < a.order.length; i += 1) {
    const id = a.order[i]!;
    if (id !== b.order[i]) return false;
    if (weightOf(a.widths, id) !== weightOf(b.widths, id)) return false;
    if (isCollapsed(a, id) !== isCollapsed(b, id)) return false;
  }
  return true;
}

/**
 * Merge a saved layout with the workspaces the daemon reports now: saved panes keep their order,
 * width and collapsed state; ids no longer listed are dropped; ids listed but not saved are appended
 * expanded at the default weight. The last expanded pane is never collapsed left alone, so the page
 * always has a focused pane while it has a workspace.
 */
export function reconcileLayout(layout: GlobalChatLayout, listedIds: readonly string[]): GlobalChatLayout {
  const listed = new Set(listedIds);
  const order: string[] = [];
  for (const id of layout.order) {
    if (listed.has(id) && !order.includes(id)) order.push(id);
  }
  for (const id of listedIds) {
    if (!order.includes(id)) order.push(id);
  }
  const widths: Record<string, number> = {};
  const collapsed: Record<string, boolean> = {};
  for (const id of order) {
    widths[id] = weightOf(layout.widths, id);
    if (isCollapsed(layout, id)) collapsed[id] = true;
  }
  if (order.length > 0 && order.every((id) => collapsed[id])) delete collapsed[order[0]!];
  return { order, widths, collapsed };
}

/** Move one pane one position left (`dir` -1) or right (1); out of range is a no-op. */
export function movePane(order: readonly string[], id: string, dir: -1 | 1): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order.slice();
  const to = from + dir;
  if (to < 0 || to >= order.length) return order.slice();
  const next = order.slice();
  const moved = next[from]!;
  next[from] = next[to]!;
  next[to] = moved;
  return next;
}

/** Insert `id` at `dropIndex`, where the index counts positions in the current order. */
export function placePane(order: readonly string[], id: string, dropIndex: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order.slice();
  const without = order.filter((x) => x !== id);
  const shifted = from < dropIndex ? dropIndex - 1 : dropIndex;
  const at = Math.min(Math.max(shifted, 0), without.length);
  const next = without.slice();
  next.splice(at, 0, id);
  return next;
}

/** Set the left pane of a pair to `leftWeight`, giving the rest of the pair back to the right one. */
export function setPairSplit(
  widths: Record<string, number>,
  leftId: string,
  rightId: string,
  leftWeight: number,
): Record<string, number> {
  const total = weightOf(widths, leftId) + weightOf(widths, rightId);
  const min = total * MIN_SPLIT;
  const nextLeft = Math.min(Math.max(leftWeight, min), total - min);
  return { ...widths, [leftId]: nextLeft, [rightId]: total - nextLeft };
}

/** Split a pair's combined weight evenly; used by double-click. */
export function resetPair(
  widths: Record<string, number>,
  leftId: string,
  rightId: string,
): Record<string, number> {
  const half = (weightOf(widths, leftId) + weightOf(widths, rightId)) / 2;
  return { ...widths, [leftId]: half, [rightId]: half };
}

/** Collapse an expanded pane, or expand a collapsed one. Collapsing the last expanded pane is refused. */
export function toggleCollapsed(layout: GlobalChatLayout, id: string): GlobalChatLayout {
  if (isCollapsed(layout, id)) {
    const collapsed = { ...layout.collapsed };
    delete collapsed[id];
    return { ...layout, collapsed };
  }
  if (!canCollapse(layout, id)) return layout;
  return { ...layout, collapsed: { ...layout.collapsed, [id]: true } };
}

/** The nearest still-expanded pane to `id`, searching left first then right; null when none. */
export function nearestExpanded(layout: GlobalChatLayout, id: string): string | null {
  const at = layout.order.indexOf(id);
  if (at < 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    const candidate = layout.order[i]!;
    if (!isCollapsed(layout, candidate)) return candidate;
  }
  for (let i = at + 1; i < layout.order.length; i += 1) {
    const candidate = layout.order[i]!;
    if (!isCollapsed(layout, candidate)) return candidate;
  }
  return null;
}

function sanitizeLayout(value: unknown): GlobalChatLayout {
  if (value === null || typeof value !== 'object') return emptyLayout();
  const rec = value as Record<string, unknown>;
  const order: string[] = [];
  if (Array.isArray(rec.order)) {
    for (const id of rec.order) {
      if (typeof id === 'string' && !order.includes(id)) order.push(id);
    }
  }
  const rawWidths = rec.widths && typeof rec.widths === 'object' ? (rec.widths as Record<string, unknown>) : {};
  const rawCollapsed =
    rec.collapsed && typeof rec.collapsed === 'object' ? (rec.collapsed as Record<string, unknown>) : {};
  const widths: Record<string, number> = {};
  const collapsed: Record<string, boolean> = {};
  for (const id of order) {
    if (isPositiveNumber(rawWidths[id])) widths[id] = rawWidths[id] as number;
    if (rawCollapsed[id] === true) collapsed[id] = true;
  }
  if (order.length > 0 && order.every((id) => collapsed[id])) delete collapsed[order[0]!];
  return { order, widths, collapsed };
}

/** The saved layout, or an empty one when there is none, it is unreadable, or storage is refused. */
export function readGlobalChatLayout(key: string = KEY): GlobalChatLayout {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return emptyLayout();
  }
  if (raw === null || raw === '') return emptyLayout();
  try {
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    return emptyLayout();
  }
}

/**
 * Persist the layout, pruned to the workspaces listed now, and return the pruned layout so the
 * caller can hold exactly what was written. A storage that refuses the write is not an error: the
 * visit still resizes, collapses and reorders, it just forgets afterwards.
 */
export function writeGlobalChatLayout(
  layout: GlobalChatLayout,
  listedIds: readonly string[],
  key: string = KEY,
): GlobalChatLayout {
  const pruned = reconcileLayout(layout, listedIds);
  try {
    if (pruned.order.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(pruned));
  } catch {
    /* private mode: the visit honours the layout, the browser just does not remember it */
  }
  return pruned;
}
