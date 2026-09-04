import type { Ticket, TicketStatus, UiStatus } from '@agent-conductor/shared';
import { TICKET_STATUSES } from '@agent-conductor/shared';

/**
 * Six owner-naming columns for eleven statuses (DESIGN-CONTRACT §5, designer's
 * call 8). backlog, proposing, approved, merging and cancelled fold into their
 * neighbouring column; the exact status is printed on the card. The table view
 * exposes all eleven.
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

/** True when the card must print its exact status because it was folded. */
export function isFolded(status: TicketStatus): boolean {
  return STATUS_COLUMN[status] !== (status as BoardColumnKey);
}

export const ALL_TICKET_STATUSES = TICKET_STATUSES;

export interface BoardColumn<T> {
  key: BoardColumnKey;
  label: string;
  owner: string;
  status: UiStatus;
  items: T[];
}

const ORDER = new Map<TicketStatus, number>(TICKET_STATUSES.map((s, i) => [s, i]));

export function foldBoard<T extends Pick<Ticket, 'status' | 'priority' | 'updatedAt'>>(tickets: readonly T[]): Array<BoardColumn<T>> {
  const cols: Array<BoardColumn<T>> = BOARD_COLUMNS.map((c) => ({ ...c, items: [] as T[] }));
  const byKey = new Map(cols.map((c) => [c.key, c]));
  for (const t of tickets) {
    const key = STATUS_COLUMN[t.status];
    byKey.get(key)?.items.push(t);
  }
  const prio = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  for (const c of cols) {
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
