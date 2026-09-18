import type { TicketKind, TicketStatus } from './enums.js';

/** Allowed status transitions per kind. Single owner of the ticket state machine (PLAN §6.2). Guards live in core. */
const CHANGE: Record<TicketStatus, readonly TicketStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['proposing', 'blocked', 'cancelled', 'backlog'],
  proposing: ['proposed', 'blocked', 'cancelled'],
  proposed: ['approved', 'proposing', 'cancelled'],
  approved: ['in_progress', 'in_review', 'blocked', 'cancelled'],
  in_progress: ['in_review', 'blocked', 'cancelled'],
  in_review: ['merging', 'in_progress', 'blocked', 'cancelled'],
  merging: ['done', 'blocked', 'in_review'],
  blocked: ['todo', 'proposing', 'approved', 'in_progress', 'in_review', 'merging', 'cancelled'],
  done: ['in_progress'],           // a human reopens a finished ticket by replying to it
  cancelled: ['todo'],
};
const TASK: Record<TicketStatus, readonly TicketStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['in_progress', 'in_review', 'done', 'blocked', 'cancelled', 'backlog'],
  proposing: [], proposed: [], approved: [],
  in_progress: ['in_review', 'done', 'blocked', 'cancelled'],
  in_review: ['merging', 'in_progress', 'done', 'blocked', 'cancelled'],
  merging: ['done', 'blocked', 'in_review'],
  blocked: ['todo', 'in_progress', 'in_review', 'merging', 'cancelled'],
  done: ['in_progress'], cancelled: ['todo'],
};
const SCOUT: Record<TicketStatus, readonly TicketStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['in_progress', 'done', 'blocked', 'cancelled', 'backlog'],
  proposing: [], proposed: [], approved: [], merging: [],
  in_progress: ['done', 'blocked', 'cancelled'],
  in_review: ['done', 'cancelled'],
  blocked: ['todo', 'in_progress', 'cancelled'],
  done: ['in_progress'], cancelled: ['todo'],
};
export const TRANSITIONS: Record<TicketKind, Record<TicketStatus, readonly TicketStatus[]>> = { change: CHANGE, task: TASK, scout: SCOUT, question: SCOUT, operational: SCOUT };

export function canTransition(kind: TicketKind, from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[kind][from].includes(to);
}

/** Statuses in which a ticket must have an action path (liveness rule). */
export const LIVENESS_STATUSES: readonly TicketStatus[] = ['todo', 'proposing', 'approved', 'in_progress', 'merging'];
/** Statuses that require a live worker (spawn if absent). */
export const WORKER_STATUSES: readonly TicketStatus[] = ['todo', 'proposing', 'proposed', 'approved', 'in_progress', 'in_review', 'merging'];
