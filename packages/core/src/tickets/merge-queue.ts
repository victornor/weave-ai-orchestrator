/**
 * The per-project merge queue (PLAN §11.4). A ticket that enters `merging` joins its project's queue;
 * the queue admits tickets to the active merge step in join order, at most `mergeConcurrency` at a
 * time, and wakes the admitted ticket's worker. Nothing else starts a merge turn.
 *
 * State lives on the ticket: `merge_queued_at` is when it joined, `merge_started_at` when it was
 * admitted. Waiting = merging with no start; active = merging with one. A position is derived from
 * the join time, never stored, so a ticket leaving the queue cannot renumber anyone incorrectly.
 */
import { nowIso, ticketRow, type Db } from '@weave-ai/db';
import { mergeConcurrencyOf, type Ticket } from '@weave-ai/shared';
import type { Actor, CoreServices, MergeQueueService, MergeQueueEntry, MergeQueueOutcome, MergeQueueView } from '../api.js';
import type { WorkspaceContext } from '../context.js';

const SYSTEM: Actor = { kind: 'system', id: null };

/** Join order: the moment the ticket joined the queue, the ticket number breaking a tie. */
const QUEUE_ORDER = 'merge_queued_at, number';

/** How many recent outcomes a queue report carries. A window on what just happened, not a history. */
const RECENT_LIMIT = 5;

export function createMergeQueue(ctx: WorkspaceContext, deps: () => CoreServices): MergeQueueService {
  const db: Db = ctx.db;
  const log = ctx.log('ticket');
  const ws = ctx.workspaceId;

  const row = (t: Record<string, unknown>): Ticket => ticketRow(t) as unknown as Ticket;

  function find(ticketId: string): Ticket | null {
    const r = db.get<Record<string, unknown>>('SELECT * FROM tickets WHERE workspace_id = ? AND id = ?', [ws, ticketId]);
    return r ? row(r) : null;
  }

  const entry = (t: Ticket, position: number | null): MergeQueueEntry => ({
    ticketId: t.id, identifier: t.identifier, title: t.title, projectId: t.projectId,
    position, queuedAt: t.mergeQueuedAt, startedAt: t.mergeStartedAt, workerId: t.workerId,
    // VS-391: the supervisor records these on the delivery for a ticket in the active merge step.
    ciState: (t.delivery?.['ciState'] as MergeQueueEntry['ciState']) ?? null,
    ciStateAt: (t.delivery?.['ciStateAt'] as string | undefined) ?? null,
  });

  function limitFor(projectId: string | null): number {
    if (!projectId) return 1;
    const p = db.get<{ policies: Record<string, unknown> | null }>('SELECT policies_json FROM projects WHERE id = ?', [projectId]);
    return mergeConcurrencyOf(p?.policies ?? null);
  }

  function activeOf(projectId: string): Ticket[] {
    return db
      .all<Record<string, unknown>>(
        "SELECT * FROM tickets WHERE workspace_id = ? AND project_id = ? AND status = 'merging' AND merge_started_at IS NOT NULL ORDER BY merge_started_at",
        [ws, projectId],
      )
      .map(row);
  }

  function waitingOf(projectId: string): Ticket[] {
    return db
      .all<Record<string, unknown>>(
        `SELECT * FROM tickets WHERE workspace_id = ? AND project_id = ? AND status = 'merging' AND merge_started_at IS NULL ORDER BY ${QUEUE_ORDER}`,
        [ws, projectId],
      )
      .map(row);
  }

  function positionOf(ticketId: string): number | null {
    const ticket = find(ticketId);
    if (!ticket?.projectId || ticket.status !== 'merging' || ticket.mergeStartedAt) return null;
    const idx = waitingOf(ticket.projectId).findIndex((w) => w.id === ticket.id);
    return idx < 0 ? null : idx + 1;
  }

  /**
   * What recently left this project's queue. Nothing stores queue history — `leave` clears both
   * stamps — so it is read back from the activity the ticket service already writes: `ticket.merged`
   * for a landing, a transition or a cancellation out of `merging` for everything else. Most recent
   * first, one row per ticket.
   */
  function recentOf(projectId: string, limit: number = RECENT_LIMIT): MergeQueueOutcome[] {
    const rows = db.all<{ action: string; details: { to?: string; mergeCommit?: string | null } | null; createdAt: string; ticketId: string; identifier: string; title: string }>(
      `SELECT a.action, a.details_json, a.created_at, t.id AS ticket_id, t.identifier, t.title
         FROM activity a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.workspace_id = ? AND t.project_id = ?
          AND (a.action = 'ticket.merged'
               OR (a.action IN ('ticket.transition','ticket.cancel') AND json_extract(a.details_json, '$.from') = 'merging'))
        ORDER BY a.created_at DESC, a.rowid DESC`,
      [ws, projectId],
    );
    const out: MergeQueueOutcome[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.ticketId)) continue;
      seen.add(r.ticketId);
      const to = r.details?.to;
      const outcome: MergeQueueOutcome['outcome'] =
        r.action === 'ticket.merged' || to === 'done' ? 'landed' : to === 'blocked' ? 'failed' : 'withdrawn';
      out.push({ ticketId: r.ticketId, identifier: r.identifier, title: r.title, outcome, at: r.createdAt, mergeCommit: r.details?.mergeCommit ?? null });
      if (out.length >= limit) break;
    }
    return out;
  }

  function forProject(projectId: string): MergeQueueView {
    return {
      projectId,
      concurrency: limitFor(projectId),
      active: activeOf(projectId).map((t) => entry(t, null)),
      waiting: waitingOf(projectId).map((t, i) => entry(t, i + 1)),
      recent: recentOf(projectId),
    };
  }

  /** The worker that will perform the merge, spawning one when the ticket has none. */
  async function workerFor(ticket: Ticket): Promise<string | null> {
    const live = db.get<{ id: string }>(
      "SELECT id FROM agents WHERE ticket_id = ? AND kind = 'worker' AND status NOT IN ('retired','done') ORDER BY created_at DESC LIMIT 1",
      [ticket.id],
    );
    if (live) return live.id;
    if (!ticket.assigneeRoleId) return null;
    const agent = await deps().workers.spawnForTicket(SYSTEM, ticket.id);
    return agent.id;
  }

  /**
   * Move one ticket into the active merge step: stamp the admission, make sure it has a worker, and
   * wake that worker to merge. The only writer of `merge_started_at`. Throws when no worker can be
   * brought, so the caller can leave the ticket at the front rather than let the next one jump it.
   */
  async function admit(ticket: Ticket): Promise<void> {
    const workerId = await workerFor(ticket);
    const now = nowIso();
    db.run('UPDATE tickets SET merge_started_at = ?, updated_at = ? WHERE id = ? AND merge_started_at IS NULL', [now, now, ticket.id]);
    const updated = find(ticket.id);
    if (updated) ctx.events.emit('ticket.updated', 'ticket', ticket.id, updated);
    if (!workerId) {
      log.warn({ ticket: ticket.identifier }, 'merge queue admitted a ticket that has no role to merge it');
      return;
    }
    try {
      deps().wake.enqueue(workerId, {
        source: 'merge_approved',
        reason: `${ticket.identifier} is at the front of the merge queue: sync with the default branch, then merge`,
        payload: { ticketId: ticket.id, mergeQueue: { admitted: true } },
        requestedBy: SYSTEM,
      });
    } catch (e) {
      log.warn({ ticket: ticket.identifier, err: String(e) }, 'merge queue wake failed');
    }
  }

  /**
   * The ticket joins its project's queue and the queue is pumped. The join time is stamped once and
   * never moved, so waiting longer never costs a ticket its place. A ticket with no project has no
   * queue to wait in and is admitted straight away.
   */
  async function join(ticketId: string): Promise<void> {
    const ticket = find(ticketId);
    if (!ticket) return;
    if (!ticket.mergeQueuedAt) db.run('UPDATE tickets SET merge_queued_at = ? WHERE id = ?', [nowIso(), ticket.id]);
    if (!ticket.projectId) {
      if (!ticket.mergeStartedAt) {
        try { await admit(ticket); }
        catch (e) { log.warn({ ticket: ticket.identifier, err: String(e) }, 'merge queue could not bring a worker for a ticket with no project'); }
      }
      return;
    }
    await pump(ticket.projectId);
  }

  /** The ticket leaves the queue, gives its slot back, and the next waiting ticket is admitted. */
  async function leave(ticketId: string): Promise<void> {
    const ticket = find(ticketId);
    db.run('UPDATE tickets SET merge_queued_at = NULL, merge_started_at = NULL WHERE id = ?', [ticketId]);
    await pump(ticket?.projectId ?? null);
  }

  /**
   * Admit waiting tickets until the project is at its limit. Called when a ticket joins or leaves the
   * queue, after a merge lands, and on the supervisor tick — so a queue whose head vanished without a
   * transition still advances.
   */
  async function pump(projectId: string | null): Promise<number> {
    if (!projectId) return 0;
    // A ticket that was already merging when this daemon upgraded has no join time. It joined before
    // anything queued since, so it takes its last update as its join time and goes to the front.
    db.run(
      "UPDATE tickets SET merge_queued_at = updated_at WHERE workspace_id = ? AND project_id = ? AND status = 'merging' AND merge_queued_at IS NULL",
      [ws, projectId],
    );
    const limit = limitFor(projectId);
    let admitted = 0;
    for (const ticket of waitingOf(projectId)) {
      if (activeOf(projectId).length >= limit) break;
      try {
        await admit(ticket);
        admitted++;
      } catch (e) {
        // No worker slot, or a spawn failure: leave the head where it is rather than letting the
        // ticket behind it jump the queue. The next pump tries again.
        log.warn({ ticket: ticket.identifier, err: String(e) }, 'merge queue could not bring a worker for the ticket at the front');
        break;
      }
    }
    return admitted;
  }

  /** Every project that currently holds a merging ticket; the supervisor pumps them all on its tick. */
  async function pumpAll(): Promise<number> {
    const projects = db.all<{ projectId: string }>(
      "SELECT DISTINCT project_id FROM tickets WHERE workspace_id = ? AND status = 'merging' AND project_id IS NOT NULL",
      [ws],
    );
    let admitted = 0;
    for (const p of projects) admitted += await pump(p.projectId);
    return admitted;
  }

  return { limitFor, positionOf, recentOf, forProject, join, leave, pump, pumpAll };
}
