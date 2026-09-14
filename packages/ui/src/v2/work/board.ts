/**
 * The V2 Work board's pure model (VS-346): the six owner-named columns, the fold from the eleven
 * ticket statuses, and the needs-you override that puts a ticket waiting on the human in Proposed.
 *
 * Kept separate from `lib/board.ts` (V1's fold) on purpose: V2 folds `proposing` into Proposed and
 * gives an open human decision precedence over status and liveness, both of which would change V1's
 * board. The version-neutral helpers — the live/paused lookups, the finished window, the merge strip
 * — are imported from there rather than copied.
 */
import type { Decision, Project, Ticket, TicketStatus, UiStatus } from '@weave-ai/shared';
import { liveWorkersByTicket, finishedAt, recentlyFinished, type FinishedMode, type LiveLookup } from '../../lib/board';
import { isAutoApproving } from '../../lib/yolo';

export interface V2BoardColumnDef {
  key: string;
  label: string;
  status: UiStatus;
}

/** The six columns, in order (HANDOFF §7). The `status` is only the header/row glyph, never a card's. */
export const V2_BOARD_COLUMNS = [
  { key: 'todo', label: 'Backlog', status: 'idle' },
  { key: 'proposed', label: 'Proposed', status: 'needs-you' },
  { key: 'in_progress', label: 'In progress', status: 'working' },
  { key: 'in_review', label: 'In review', status: 'merging' },
  { key: 'blocked', label: 'Blocked', status: 'blocked' },
  { key: 'done', label: 'Done', status: 'done' },
] as const satisfies ReadonlyArray<V2BoardColumnDef>;

export type V2BoardColumnKey = (typeof V2_BOARD_COLUMNS)[number]['key'];

/** Where each status lands before the needs-you and live-worker overrides. Identity for the six owners. */
export const V2_STATUS_COLUMN: Record<TicketStatus, V2BoardColumnKey> = {
  backlog: 'todo',
  todo: 'todo',
  proposing: 'proposed',
  proposed: 'proposed',
  approved: 'in_progress',
  in_progress: 'in_progress',
  in_review: 'in_review',
  merging: 'in_review',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'done',
};

/**
 * Statuses where the human owns the next move. A live worker on one of these is waiting for an
 * answer, not working, so it does not drag the ticket to In progress (same rule as V1's board).
 */
const HUMAN_OWNED: readonly TicketStatus[] = ['proposed', 'in_review', 'blocked', 'done', 'cancelled'];

/**
 * Which V2 column a ticket lands in. Precedence: an open decision for the human wins (Proposed),
 * then a live worker (In progress) for a ticket whose column the human does not own, then the
 * stored status. `cancelled` folds into Done and is governed by the finished window.
 */
export function v2ColumnFor(
  status: TicketStatus,
  opts: { live?: boolean; needsYou?: boolean } = {},
): V2BoardColumnKey {
  if (opts.needsYou) return 'proposed';
  if (opts.live && !HUMAN_OWNED.includes(status)) return 'in_progress';
  return V2_STATUS_COLUMN[status];
}

/** The `UiStatus` a ticket's folded column carries, for a glyph on a row that is not grouped by column. */
export function v2ColumnStatusOf(
  status: TicketStatus,
  opts: { live?: boolean; needsYou?: boolean } = {},
): UiStatus {
  const key = v2ColumnFor(status, opts);
  return V2_BOARD_COLUMNS.find((c) => c.key === key)!.status;
}

/**
 * The tickets with an open decision the daemon will not auto-approve under the active policy.
 * Same computation as V1's board: map each open human-owned decision to its ticket, and keep it
 * unless `isAutoApproving` says the daemon will grant it (so an auto-approved ticket reads as
 * moving, not as waiting on the human).
 */
export function needsYouTicketIds(
  decisions: readonly Pick<Decision, 'ticketId' | 'kind' | 'status'>[],
  ticketsById: ReadonlyMap<string, Pick<Ticket, 'projectId'>>,
  projects: readonly Pick<Project, 'id' | 'policies'>[],
  config: Record<string, unknown> | undefined,
): Set<string> {
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const ids = new Set<string>();
  for (const d of decisions) {
    if (!d.ticketId) continue;
    const ticket = ticketsById.get(d.ticketId);
    if (!ticket) continue;
    const projectId = ticket.projectId;
    if (!projectId) continue;
    if (isAutoApproving(d, config, byProject.get(projectId) ?? null)) continue;
    ids.add(d.ticketId);
  }
  return ids;
}

export interface V2BoardColumn<T> {
  key: V2BoardColumnKey;
  label: string;
  status: UiStatus;
  items: T[];
}

const PRIORITY: Record<Ticket['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Fold a ticket set into the six columns, with the same ordering V1's board uses per column. */
export function foldV2Board<T extends Pick<Ticket, 'id' | 'status' | 'priority' | 'updatedAt'> & Pick<Ticket, 'completedAt' | 'cancelledAt'>>(
  tickets: readonly T[],
  opts: { live?: LiveLookup; needsYou?: LiveLookup } = {},
): Array<V2BoardColumn<T>> {
  const cols: Array<V2BoardColumn<T>> = V2_BOARD_COLUMNS.map((c) => ({ key: c.key, label: c.label, status: c.status, items: [] as T[] }));
  const byKey = new Map(cols.map((c) => [c.key, c]));
  for (const t of tickets) {
    const key = v2ColumnFor(t.status, { live: opts.live?.has(t.id), needsYou: opts.needsYou?.has(t.id) });
    byKey.get(key)?.items.push(t);
  }
  for (const c of cols) {
    if (c.key === 'done') {
      c.items.sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
      continue;
    }
    c.items.sort((a, b) => {
      const p = PRIORITY[a.priority] - PRIORITY[b.priority];
      if (p !== 0) return p;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  return cols;
}

/** The finished tickets a mode shows: nothing hidden, everything, or the recent window. */
export function v2ShownFinished<T extends Pick<Ticket, 'completedAt' | 'cancelledAt' | 'updatedAt'>>(
  all: readonly T[],
  mode: FinishedMode,
  now: Date = new Date(),
): T[] {
  if (mode === 'hide') return [];
  return mode === 'all' ? [...all] : recentlyFinished(all, now);
}

export interface TitleSegment {
  text: string;
  /** True when this run is a match for the active search, so the caller can highlight it. */
  match: boolean;
}

/**
 * Splits a title into matched and unmatched runs for the active search (VS-379). The query is the
 * same case-insensitive substring the daemon's `LIKE %query%` applies, so the highlight never
 * marks a word the result was not found by. An empty query is one unmatched run, and regex
 * metacharacters in the query are escaped so a search for `a.b` matches literally.
 */
export function highlightSegments(text: string, query: string): TitleSegment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  const out: TitleSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), match: false });
    out.push({ text: m[0], match: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length ? out : [{ text, match: false }];
}

export { liveWorkersByTicket };
