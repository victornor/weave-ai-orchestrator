import { nowIso } from '@weave-ai/db';
import { OcError, type Run, type RunEvent, type RunStatus, type RunTrace } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, Page, RunsService } from '../api.js';
import { recordActivity } from '../events.js';
import { runState } from './active.js';

export { createDispatcher, type CoreDispatcher } from './dispatcher.js';
export { executeRun, mintRunToken, makeRedactor } from './engine.js';
export { signRunToken, verifyRunToken, runTokenSecret, peekWorkspaceId, isRunToken, RUN_TOKEN_PREFIX, RUN_TOKEN_TTL_SECONDS, type RunTokenClaims } from './runtoken.js';
export { runState, emitRunEvent, recordHumanInputEvent, describeLiveInput, type ActiveRun, type LiveInputStatus } from './active.js';

/** The aggregate row behind one run's trace, named as the mapper hands it back. */
interface Counts { events: number; toolCalls: number; errors: number; texts: number; files: number }

/** How long a run took by its own clock. Null while it is still going, and null for a run that never started. */
function elapsed(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

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

    /** The newest `limit` events, handed back oldest-first. Reads the tail without loading the run. */
    tail(id: string, limit = 50): RunEvent[] {
      const rows = ctx.db.all<RunEvent>('SELECT * FROM run_events WHERE run_id = ? ORDER BY seq DESC LIMIT ?', [id, limit]);
      return rows.reverse();
    },

    /**
     * The phase markers alone. The engine records one when a phase *ends*, so they are scattered
     * across the run — `build_prompt` near the head, `turn` after everything the turn did — and
     * neither the head nor the tail is guaranteed to hold them all. Bounded by `RUN_PHASES`.
     */
    phaseTimings(id: string): RunEvent[] {
      return ctx.db.all<RunEvent>("SELECT * FROM run_events WHERE run_id = ? AND type = 'run.phase.timing' ORDER BY seq", [id]);
    },

    /**
     * What a run did, counted rather than replayed (VS-74).
     *
     * The chat labels a whole page of history with this, so it is one grouped aggregate for the set
     * and never one query per run. Everything it reports is already in `run_events`, which is what
     * makes a turn recorded long before this existed describable too. `files` is distinct paths, so
     * a file edited four times is one file; the duration is the run's own clock rather than the sum
     * of its phases, because a run that died mid-phase still took the time it took.
     *
     * The two selectors are a union, not a narrowing: the ids are the runs a surface already knows
     * it needs, and the agent window catches the turns it has no other way to hear about — the wake
     * that filed a ticket and said nothing.
     */
    traces(filter: { ids?: readonly string[]; agentId?: string; since?: string; limit?: number } = {}): RunTrace[] {
      // A duplicate id would multiply the run into the answer.
      const ids = [...new Set(filter.ids ?? [])].filter((id) => id.length > 0);
      const window = filter.agentId ? [filter.agentId, filter.since ?? ''] : null;
      if (!ids.length && !window) return [];
      const or: string[] = [];
      const params: unknown[] = [ctx.workspaceId];
      if (ids.length) { or.push(`id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
      if (window) { or.push('(agent_id = ? AND created_at >= ?)'); params.push(...window); }
      const runs = ctx.db.all<Pick<Run, 'id' | 'status' | 'agentId' | 'createdAt' | 'startedAt' | 'finishedAt' | 'summary' | 'model' | 'usage'>>(
        `SELECT id, status, agent_id, created_at, started_at, finished_at, summary, model, usage_json FROM runs
          WHERE workspace_id = ? AND (${or.join(' OR ')}) ORDER BY created_at DESC, id DESC LIMIT ?`,
        [...params, filter.limit ?? 200] as never[],
      );
      if (!runs.length) return [];

      const holes = runs.map(() => '?').join(',');
      const counts = new Map<string, Counts>();
      for (const row of ctx.db.all<Counts & { runId: string }>(
        `SELECT run_id,
                COUNT(*) AS events,
                SUM(CASE WHEN type = 'tool.call' THEN 1 ELSE 0 END) AS tool_calls,
                SUM(CASE WHEN type = 'error' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN type IN ('assistant.text', 'assistant.thinking') THEN 1 ELSE 0 END) AS texts,
                COUNT(DISTINCT CASE WHEN type = 'file.changed' THEN json_extract(payload_json, '$.path') END) AS files
           FROM run_events WHERE run_id IN (${holes}) GROUP BY run_id`,
        runs.map((r) => r.id) as never[],
      )) counts.set(row.runId, row);

      // Oldest first: every caller renders these in the order the turns happened.
      return runs.reverse().map((run) => {
        const c = counts.get(run.id);
        return {
          runId: run.id,
          status: run.status,
          agentId: run.agentId,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: elapsed(run.startedAt, run.finishedAt),
          toolCalls: c?.toolCalls ?? 0,
          files: c?.files ?? 0,
          errors: c?.errors ?? 0,
          texts: c?.texts ?? 0,
          events: c?.events ?? 0,
          summary: run.summary,
          model: run.model,
          usage: run.usage,
        };
      });
    },

    async cancel(actor: Actor, id: string, mode: 'interrupt' | 'kill' = 'interrupt', cause?: 'message'): Promise<void> {
      const run = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
      if (!run) throw new OcError('not_found', `run ${id} not found`);
      const entry = state.active.get(id);
      if (entry) {
        entry.cancelled = { mode, cause };
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
