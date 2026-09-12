import type { Agent, AgentStatus, Ticket, TicketStatus, UiStatus } from '@weave-ai/shared';
import { TICKET_STATUSES, ticketUiStatus } from '@weave-ai/shared';

/**
 * Six owner-naming columns for eleven statuses (DESIGN-CONTRACT §5, designer's
 * call 8). backlog, proposing, approved, merging and cancelled fold into their
 * neighbouring column; the exact status is printed on the card. The table view
 * exposes all eleven. On top of that, a live worker overrides the status and puts
 * its ticket In progress — see `columnFor`.
 */
export const BOARD_COLUMNS = [
  { key: 'todo', label: 'Todo', owner: 'unassigned', status: 'idle' },
  { key: 'proposed', label: 'Proposed', owner: 'you', status: 'needs-you' },
  { key: 'in_progress', label: 'In progress', owner: 'worker', status: 'working' },
  { key: 'in_review', label: 'In review', owner: 'you', status: 'merging' },
  { key: 'blocked', label: 'Blocked', owner: 'blocked', status: 'blocked' },
  { key: 'done', label: 'Done', owner: 'nobody', status: 'done' },
] as const satisfies ReadonlyArray<{ key: TicketStatus; label: string; owner: string; status: UiStatus }>;

export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]['key'];

/** Which column a status lands in. Identity for the six that own a column. */
export const STATUS_COLUMN: Record<TicketStatus, BoardColumnKey> = {
  backlog: 'todo',
  todo: 'todo',
  proposing: 'in_progress',
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
 * A worker in one of these is on its ticket right now: spawned and not finished.
 * `paused` and `error` are not live — nothing is moving — and `done`/`retired` are over.
 */
const LIVE_AGENT_STATUSES: readonly AgentStatus[] = ['provisioning', 'active', 'running'];

export function isLiveWorker(worker: Pick<Agent, 'status'> | null | undefined): boolean {
  return Boolean(worker && LIVE_AGENT_STATUSES.includes(worker.status));
}

/**
 * Live workers currently on a ticket, newest first. The Live page's working set: same liveness
 * predicate as the board, listed as workers rather than keyed by ticket, so two live workers on
 * one ticket both appear. The conductor is excluded (`kind === 'worker'`).
 */
export function liveWorkingAgents(workers: readonly Agent[]): Agent[] {
  return workers
    .filter((w) => w.kind === 'worker' && w.ticketId && isLiveWorker(w))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Ticket id → the live worker on it. A ticket's `workerId` stays set after the worker
 * retires, so liveness can only come from the workers themselves.
 */
export function liveWorkersByTicket(workers: readonly Agent[]): Map<string, Agent> {
  const byTicket = new Map<string, Agent>();
  for (const w of workers) {
    if (!w.ticketId || !isLiveWorker(w)) continue;
    const seen = byTicket.get(w.ticketId);
    if (!seen || w.createdAt > seen.createdAt) byTicket.set(w.ticketId, w);
  }
  return byTicket;
}

/**
 * Ticket id → its paused worker, independent of `liveWorkersByTicket`. A paused worker is, by
 * definition, not live (VS-137): a lookup filtered to `isLiveWorker` can never contain one, so the
 * board's "paused · reason" badge needs this separate map rather than the live one to ever render.
 */
export function pausedWorkersByTicket(workers: readonly Agent[]): Map<string, Agent> {
  const byTicket = new Map<string, Agent>();
  for (const w of workers) {
    if (!w.ticketId || w.status !== 'paused') continue;
    const seen = byTicket.get(w.ticketId);
    if (!seen || w.createdAt > seen.createdAt) byTicket.set(w.ticketId, w);
  }
  return byTicket;
}

/** Anything with `has(ticketId)`: the map above, or a plain set of ids. */
export interface LiveLookup {
  has: (ticketId: string) => boolean;
}

/**
 * Statuses where the human owns the next move. A live worker sitting on one of these is
 * waiting for an answer, not working, so the ticket stays in the column that names its owner.
 */
const HUMAN_OWNED: readonly TicketStatus[] = ['proposed', 'in_review', 'blocked', 'done', 'cancelled'];

/**
 * Which column a ticket lands in. A live worker puts it In progress whatever its stored
 * status says — a `change` ticket sits in `todo` for its whole propose turn, and `merging`
 * folds into In review, so status alone leaves In progress empty while workers are running.
 */
export function columnFor(status: TicketStatus, opts: { live?: boolean } = {}): BoardColumnKey {
  return opts.live && !HUMAN_OWNED.includes(status) ? 'in_progress' : STATUS_COLUMN[status];
}

/** True when the card must print its exact status because it is not in the column that status owns. */
export function isFolded(status: TicketStatus, opts: { live?: boolean } = {}): boolean {
  return columnFor(status, opts) !== (status as BoardColumnKey);
}

/**
 * The status token a ticket shows on the board. `merging` beats a live worker because it is
 * the more specific fact about what that worker is doing, and it is what keeps a merging
 * ticket from reading like one waiting for review.
 */
export function ticketBoardStatus(
  status: TicketStatus,
  opts: { live?: boolean; needsYou?: boolean; autoApproving?: boolean; stalled?: boolean } = {},
): UiStatus {
  // A ticket whose open approval the daemon will grant under YOLO mode is not waiting on the human,
  // whatever its status would otherwise say (PLAN §15): it reads as still moving.
  if (opts.autoApproving) return opts.stalled ? 'stalled' : 'working';
  if (opts.needsYou) return 'needs-you';
  if (opts.stalled) return 'stalled';
  if (status === 'merging') return 'merging';
  if (opts.live && !HUMAN_OWNED.includes(status)) return 'working';
  return ticketUiStatus(status);
}

export const ALL_TICKET_STATUSES = TICKET_STATUSES;

/* ------------------------------------------------------------ finished tickets
 * The Done column is there by default, so it has to be a window rather than the whole
 * history: what landed in the last week, capped so a busy day cannot bury the board.
 * "Show all" widens it to every terminal ticket the query returned.
 */

export type FinishedMode = 'recent' | 'all' | 'hide';

export const RECENT_FINISHED_DAYS = 7;
export const RECENT_FINISHED_MAX = 20;

export type Finishable = Pick<Ticket, 'completedAt' | 'cancelledAt' | 'updatedAt'>;

/** When a ticket reached done or cancelled. `updatedAt` covers rows finished before those columns were written. */
export function finishedAt(t: Finishable): string {
  return t.completedAt ?? t.cancelledAt ?? t.updatedAt;
}

/** The finished tickets shown by default: the last {@link RECENT_FINISHED_DAYS} days, at most {@link RECENT_FINISHED_MAX}, newest first. */
export function recentlyFinished<T extends Finishable>(tickets: readonly T[], now: Date = new Date()): T[] {
  const cutoff = new Date(now.getTime() - RECENT_FINISHED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return tickets
    .filter((t) => finishedAt(t) >= cutoff)
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)))
    .slice(0, RECENT_FINISHED_MAX);
}

/** `?done=` round-trip. The historical `1` meant "every finished ticket" and keeps that meaning. */
export function finishedModeFromSearch(value: string | number | undefined): FinishedMode {
  const v = String(value ?? '');
  if (v === '1' || v === 'all') return 'all';
  if (v === '0' || v === 'hide') return 'hide';
  return 'recent';
}

/** The `?done=` value for a mode; `undefined` for the default, so the URL stays clean. */
export function finishedModeSearch(mode: FinishedMode): string | undefined {
  return mode === 'recent' ? undefined : mode === 'all' ? '1' : '0';
}

export interface BoardColumn<T> {
  key: BoardColumnKey;
  label: string;
  owner: string;
  status: UiStatus;
  items: T[];
}

const ORDER = new Map<TicketStatus, number>(TICKET_STATUSES.map((s, i) => [s, i]));

export function foldBoard<T extends Pick<Ticket, 'id' | 'status' | 'priority' | 'updatedAt'> & Finishable>(
  tickets: readonly T[],
  live?: LiveLookup,
): Array<BoardColumn<T>> {
  const cols: Array<BoardColumn<T>> = BOARD_COLUMNS.map((c) => ({ ...c, items: [] as T[] }));
  const byKey = new Map(cols.map((c) => [c.key, c]));
  for (const t of tickets) {
    const key = columnFor(t.status, { live: live?.has(t.id) });
    byKey.get(key)?.items.push(t);
  }
  const prio = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  for (const c of cols) {
    // Done is a timeline, not a queue: priority stops meaning anything once a ticket has landed.
    if (c.key === 'done') {
      c.items.sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
      continue;
    }
    c.items.sort((a, b) => {
      const p = prio[a.priority] - prio[b.priority];
      if (p !== 0) return p;
      const s = (ORDER.get(a.status) ?? 0) - (ORDER.get(b.status) ?? 0);
      if (s !== 0) return s;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  return cols;
}

export interface BoardFilters {
  project?: string | undefined;
  role?: string | undefined;
  kind?: string | undefined;
  priority?: string | undefined;
  status?: TicketStatus | undefined;
}

export function filterTickets<T extends Pick<Ticket, 'status' | 'kind' | 'priority' | 'projectId' | 'assigneeRoleId'>>(
  tickets: readonly T[],
  f: BoardFilters,
): T[] {
  return tickets.filter(
    (t) =>
      (!f.project || t.projectId === f.project) &&
      (!f.role || t.assigneeRoleId === f.role) &&
      (!f.kind || t.kind === f.kind) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.status || t.status === f.status),
  );
}

/**
 * What the board's merge-queue line says (PLAN §11.4). Counted over every ticket the board loaded,
 * not over the filtered view: the line is about the workspace's landing, and a number that changed
 * with the project filter would be the old panel's problem in another shape.
 */
export function mergeStrip(tickets: readonly Pick<Ticket, 'status' | 'mergeStartedAt'>[]): { landing: number; waiting: number } {
  let landing = 0;
  let waiting = 0;
  for (const t of tickets) {
    if (t.status !== 'merging') continue;
    if (t.mergeStartedAt) landing++;
    else waiting++;
  }
  return { landing, waiting };
}
