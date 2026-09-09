/**
 * Briefing snapshot (PLAN §10.5): the four sections the conductor always renders —
 * Needs you / Recently landed / Under way / Up next — plus warnings.
 * Deterministic and read-only: computed from the db, writes no activity and emits no events.
 */
import type * as S from '@agent-conductor/shared';
import { TERMINAL_TICKET_STATUSES } from '@agent-conductor/shared';
import { nowIso } from '@agent-conductor/db';
import type { BriefingService } from '../api.js';
import type { WorkspaceContext } from '../context.js';

const LANDED_WINDOW_DAYS = 7;
const NEEDS_YOU_LIMIT = 20;
const LANDED_LIMIT = 10;
const QUEUED_LIMIT = 20;
/** A worker still holding its slot: anything that has not been retired or finished. */
const LIVE_WORKER_STATUSES = "('provisioning','active','running','paused','error')";

export function createBriefingService(ctx: WorkspaceContext): BriefingService {
  const log = ctx.log('daemon');

  const terminal = TERMINAL_TICKET_STATUSES.map(() => '?').join(',');

  const needsYou = (): S.Briefing['needsYou'] =>
    ctx.db.all<{ id: string; ticketId: string | null; title: string; kind: string; recommendation: string | null; createdAt: string }>(
      `SELECT id, ticket_id, title, kind, recommendation, created_at FROM decisions
       WHERE workspace_id = ? AND status = 'open' AND owner = 'human' ORDER BY created_at DESC LIMIT ?`,
      [ctx.workspaceId, NEEDS_YOU_LIMIT],
    ).map((d) => ({ decisionId: d.id, ticketId: d.ticketId, title: d.title, kind: d.kind, recommendation: d.recommendation, createdAt: d.createdAt }));

  const landed = (cutoff: string): S.Briefing['landed'] =>
    ctx.db.all<{ id: string; identifier: string; title: string; completedAt: string }>(
      `SELECT id, identifier, title, completed_at FROM tickets
       WHERE workspace_id = ? AND status = 'done' AND completed_at IS NOT NULL AND completed_at >= ?
       ORDER BY completed_at DESC LIMIT ?`,
      [ctx.workspaceId, cutoff, LANDED_LIMIT],
    ).map((t) => {
      const pr = ctx.db.get<{ url: string | null }>(
        "SELECT url FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' AND url IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [t.id],
      );
      const base = { ticketId: t.id, identifier: t.identifier, title: t.title, completedAt: t.completedAt };
      return pr?.url ? { ...base, prUrl: pr.url } : base;
    });

  const underway = (): S.Briefing['underway'] =>
    ctx.db.all<{ workerId: string; workerName: string; workerStatus: string; workerPauseReason: string | null; ticketId: string; identifier: string; title: string; status: string }>(
      `SELECT a.id AS workerId, a.name AS workerName, a.status AS workerStatus, a.pause_reason AS workerPauseReason,
              t.id AS ticketId, t.identifier AS identifier, t.title AS title, t.status AS status
       FROM agents a JOIN tickets t ON t.id = a.ticket_id
       WHERE a.workspace_id = ? AND a.kind = 'worker' AND a.status <> 'retired' AND t.status NOT IN (${terminal})
       ORDER BY t.updated_at DESC`,
      [ctx.workspaceId, ...TERMINAL_TICKET_STATUSES],
    ).map((w) => ({
      ...w,
      lastStatus: ctx.db.get<{ body: string }>(
        "SELECT body FROM ticket_comments WHERE ticket_id = ? AND kind = 'status' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [w.ticketId],
      )?.body ?? null,
    }));

  const queued = (): S.Briefing['queued'] =>
    ctx.db.all<{ id: string; identifier: string; title: string; assigneeRoleId: string | null }>(
      `SELECT t.id, t.identifier, t.title, t.assignee_role_id FROM tickets t
       WHERE t.workspace_id = ? AND t.status IN ('todo','backlog')
         AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.ticket_id = t.id AND a.kind = 'worker' AND a.status IN ${LIVE_WORKER_STATUSES})
       ORDER BY t.created_at DESC LIMIT ?`,
      [ctx.workspaceId, QUEUED_LIMIT],
    ).map((t) => ({ ticketId: t.id, identifier: t.identifier, title: t.title, reason: queueReason(t.assigneeRoleId) }));

  const queueReason = (roleId: string | null): string => {
    if (!roleId) return 'unassigned';
    const role = ctx.db.get<{ projectId: string }>('SELECT project_id FROM roles WHERE id = ? AND workspace_id = ?', [roleId, ctx.workspaceId]);
    if (!role) return 'unassigned';
    const project = ctx.db.get<{ maxWorkers: number }>('SELECT max_workers FROM projects WHERE id = ?', [role.projectId]);
    if (!project) return 'waiting to be picked up';
    const live = ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM agents WHERE project_id = ? AND kind = 'worker' AND status IN ${LIVE_WORKER_STATUSES}`,
      [role.projectId],
    )?.n ?? 0;
    return Number(live) >= Number(project.maxWorkers) ? 'waiting for a worker slot' : 'waiting to be picked up';
  };

  const warnings = (cutoff: string): string[] => {
    const out: string[] = [];
    for (const a of ctx.db.all<{ name: string; errorText: string | null }>(
      "SELECT name, error_text FROM agents WHERE workspace_id = ? AND status = 'error' ORDER BY updated_at DESC",
      [ctx.workspaceId],
    )) out.push(`${a.name} failed: ${a.errorText ?? 'unknown error'}`);

    for (const t of ctx.db.all<{ identifier: string; unblock: { owner?: string; action?: string } | null }>(
      "SELECT identifier, unblock_json FROM tickets WHERE workspace_id = ? AND status = 'blocked' ORDER BY updated_at DESC",
      [ctx.workspaceId],
    )) {
      const action = t.unblock?.owner && t.unblock?.action ? t.unblock.action : null;
      out.push(action ? `${t.identifier} blocked: ${action}` : `${t.identifier} blocked with no action path`);
    }

    for (const d of ctx.db.all<{ title: string }>(
      "SELECT title FROM decisions WHERE workspace_id = ? AND status = 'expired' AND COALESCE(expires_at, created_at) >= ? ORDER BY COALESCE(expires_at, created_at) DESC",
      [ctx.workspaceId, cutoff],
    )) out.push(`decision expired: ${d.title}`);

    return out;
  };

  return {
    snapshot(): S.Briefing {
      const generatedAt = nowIso();
      const cutoff = new Date(Date.parse(generatedAt) - LANDED_WINDOW_DAYS * 86400e3).toISOString();
      const snap: S.Briefing = { needsYou: needsYou(), landed: landed(cutoff), underway: underway(), queued: queued(), warnings: warnings(cutoff), generatedAt };
      log.debug({ needsYou: snap.needsYou.length, landed: snap.landed.length, underway: snap.underway.length, queued: snap.queued.length, warnings: snap.warnings.length }, 'briefing snapshot');
      return snap;
    },
  };
}
