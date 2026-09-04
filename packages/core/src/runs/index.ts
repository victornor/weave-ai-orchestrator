import { nowIso } from '@agent-conductor/db';
import { OcError, type Run, type RunEvent, type RunStatus } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, Page, RunsService } from '../api.js';
import { recordActivity } from '../events.js';
import { runState } from './active.js';

export { createDispatcher, type CoreDispatcher } from './dispatcher.js';
export { executeRun, mintRunToken, makeRedactor } from './engine.js';
export { signRunToken, verifyRunToken, runTokenSecret, peekWorkspaceId, isRunToken, RUN_TOKEN_PREFIX, RUN_TOKEN_TTL_SECONDS, type RunTokenClaims } from './runtoken.js';
export { runState, emitRunEvent, type ActiveRun } from './active.js';

export function createRunsService(ctx: WorkspaceContext, _deps: () => CoreServices): RunsService {
  const log = ctx.log('run');
  const state = runState(ctx);

  return {
    list(filter = {}): Page<Run> {
      const where: string[] = ['workspace_id = ?'];
      const params: unknown[] = [ctx.workspaceId];
      if (filter.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
      if (filter.ticketId) { where.push('ticket_id = ?'); params.push(filter.ticketId); }
      if (filter.status?.length) { where.push(`status IN (${filter.status.map(() => '?').join(',')})`); params.push(...filter.status); }
      const sql = `FROM runs WHERE ${where.join(' AND ')}`;
      const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n ${sql}`, params as never[])?.n ?? 0;
      const items = ctx.db.all<Run>(`SELECT * ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, filter.limit ?? 50, filter.offset ?? 0] as never[]);
      return { items, total };
    },

    get(id: string): Run {
      const r = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
      if (!r) throw new OcError('not_found', `run ${id} not found`);
      return r;
    },

    events(id: string, afterSeq = 0, limit = 500): RunEvent[] {
      return ctx.db.all<RunEvent>('SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?', [id, afterSeq, limit]);
    },

    async cancel(actor: Actor, id: string, mode: 'interrupt' | 'kill' = 'interrupt'): Promise<void> {
      const run = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
      if (!run) throw new OcError('not_found', `run ${id} not found`);
      const entry = state.active.get(id);
      if (entry) {
        entry.cancelled = mode;
        try { await entry.cancel(mode); } catch (e) { log.warn({ runId: id, err: String(e) }, 'cancel failed'); }
      } else if (run.status === 'running' || run.status === 'queued') {
        const status: RunStatus = 'cancelled';
        ctx.db.update('runs', id, { status, finishedAt: nowIso(), errorCode: 'cancelled', errorFamily: 'tooling' });
        ctx.db.run("UPDATE wakeups SET status = 'cancelled', finished_at = ? WHERE run_id = ?", [nowIso(), id]);
        ctx.db.update('agents', run.agentId, { status: 'active', updatedAt: nowIso() });
      }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'run.cancel', 'run', id, { mode }, run.ticketId);
    },

    onEvent(handler: (runId: string, ev: RunEvent) => void): () => void {
      const wrapped = (runId: string, ev: RunEvent) => handler(runId, ev);
      state.emitter.on('event', wrapped);
      return () => { state.emitter.off('event', wrapped); };
    },
  };
}
