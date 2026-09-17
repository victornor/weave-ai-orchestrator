/**
 * VS-498: `worker_stall_state` accessors. A row's existence is the persisted fact that a worker is
 * currently in an active stall/recovery cycle — set and cleared by the supervisor's stall sweep
 * (`stalledWorkerScan` in `./index.js`), read by the workers/tickets routes so a stalled worker
 * renders distinctly from a working one instead of only showing up for one digest cycle.
 */
import type { WorkspaceContext } from '../context.js';

export interface WorkerStallState {
  agentId: string;
  workspaceId: string;
  ticketId: string;
  attempts: number;
  firstDetectedAt: string;
  lastAttemptAt: string | null;
  lastAttemptWakeId: string | null;
  escalatedAt: string | null;
  escalationDecisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getWorkerStallState(ctx: WorkspaceContext, agentId: string): WorkerStallState | null {
  return ctx.db.get<WorkerStallState>('SELECT * FROM worker_stall_state WHERE agent_id = ?', [agentId]) ?? null;
}

/** Whether a worker is currently in an active stall/recovery cycle — the fact the reads surface. */
export function isWorkerStalled(ctx: WorkspaceContext, agentId: string): boolean {
  return Boolean(getWorkerStallState(ctx, agentId));
}

/** Every worker currently in an active stall/recovery cycle, for the sweep's own reset pass. */
export function allWorkerStallStates(ctx: WorkspaceContext): WorkerStallState[] {
  return ctx.db.all<WorkerStallState>('SELECT * FROM worker_stall_state WHERE workspace_id = ?', [ctx.workspaceId]);
}

export function createWorkerStallState(ctx: WorkspaceContext, agentId: string, ticketId: string, atIso: string): void {
  ctx.db.insert('worker_stall_state', {
    agentId, workspaceId: ctx.workspaceId, ticketId, attempts: 0,
    firstDetectedAt: atIso, createdAt: atIso, updatedAt: atIso,
  });
}

export function recordRecoveryAttempt(ctx: WorkspaceContext, agentId: string, attempts: number, wakeId: string, atIso: string): void {
  ctx.db.run(
    'UPDATE worker_stall_state SET attempts = ?, last_attempt_at = ?, last_attempt_wake_id = ?, updated_at = ? WHERE agent_id = ?',
    [attempts, atIso, wakeId, atIso, agentId],
  );
}

export function recordEscalation(ctx: WorkspaceContext, agentId: string, decisionId: string, atIso: string): void {
  ctx.db.run(
    'UPDATE worker_stall_state SET escalated_at = ?, escalation_decision_id = ?, updated_at = ? WHERE agent_id = ?',
    [atIso, decisionId, atIso, agentId],
  );
}

export function deleteWorkerStallState(ctx: WorkspaceContext, agentId: string): void {
  ctx.db.run('DELETE FROM worker_stall_state WHERE agent_id = ?', [agentId]);
}
