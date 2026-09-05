/**
 * Jobs: one long-running workspace-setup operation, observable while it runs (VS-37,
 * `workspace-setup/setup-jobs`).
 *
 * The split that keeps the record small is durability. Sub-step transitions are rare and always
 * written; output lines are frequent, so every line goes to the in-process emitter — which is what a
 * connected surface tails — while the row keeps only the last `JOB_LOG_LINES`, flushed at most every
 * `JOB_LOG_FLUSH_MS` and always on a transition or at the end. A client attaching later than the tail
 * gets the tail and then the live stream; keeping every line would mean an unbounded record for a
 * clone's stdout, which is not the product the way a run's events are.
 *
 * The workspace outbox learns only that a job started and that it finished. Per-line events there
 * would be replayed to every SSE client and pushed through every hook and webhook.
 */
import { EventEmitter } from 'node:events';
import { newId, nowIso, type Params } from '@agent-conductor/db';
import { JOB_STEPS, OcError, isTerminalJob, type Job, type JobKind, type JobLogLine, type JobLogStream, type JobState, type JobStep, type JobStepState } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, JobsService, JobStreamItem } from '../api.js';

/** The tail kept on the row, matching the upgrade record's budget. */
export const JOB_LOG_LINES = 200;
/** How often a running job's log tail is written back to the row. */
export const JOB_LOG_FLUSH_MS = 250;

const actorString = (actor: Actor): string => `${actor.kind}:${actor.id ?? 'system'}`;

export function createJobsService(ctx: WorkspaceContext, _deps: () => CoreServices): JobsService {
  const log = ctx.log('daemon');
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);

  /** Live state for the jobs this process is running: the tail as truth between flushes. */
  const live = new Map<string, { lines: JobLogLine[]; seq: number; dirty: boolean; timer: ReturnType<typeof setTimeout> | null }>();

  const read = (id: string): Job => {
    const row = ctx.db.get<Job>('SELECT * FROM jobs WHERE workspace_id = ? AND id = ?', [ctx.workspaceId, id]);
    if (!row) throw new OcError('not_found', `job ${id} not found`);
    return row;
  };

  /**
   * The row plus whatever has not been flushed yet. Between flushes the in-memory tail is the truth,
   * and a surface attaching mid-step must see the lines that made it wait, not the last written batch.
   */
  const hydrate = (row: Job): Job => {
    const state = live.get(row.id);
    return state ? { ...row, log: [...state.lines], logSeq: state.seq } : row;
  };

  /**
   * Synchronous on purpose. Every caller has already written the record, and a deferred emit would
   * deliver an item to a stream that opened after it — which the stream then shows twice, once from
   * its replay and once from the tail.
   */
  const publish = (item: JobStreamItem): void => { emitter.emit('item', item); };

  function flush(jobId: string): void {
    const state = live.get(jobId);
    if (!state || !state.dirty) return;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    state.dirty = false;
    ctx.db.update('jobs', jobId, { logJson: state.lines, logSeq: state.seq });
  }

  function forget(jobId: string): void {
    const state = live.get(jobId);
    if (state?.timer) clearTimeout(state.timer);
    live.delete(jobId);
  }

  const service: JobsService = {
    get: (id: string): Job => hydrate(read(id)),

    list(filter = {}): Job[] {
      const where: string[] = ['workspace_id = ?'];
      const args: Params & unknown[] = [ctx.workspaceId];
      if (filter.kind) { where.push('kind = ?'); args.push(filter.kind); }
      if (filter.entityId) { where.push('entity_id = ?'); args.push(filter.entityId); }
      args.push(filter.limit ?? 50);
      return ctx.db.all<Job>(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY started_at DESC, id DESC LIMIT ?`, args).map(hydrate);
    },

    running(entityId: string): Job | null {
      const row = ctx.db.get<Job>("SELECT * FROM jobs WHERE workspace_id = ? AND entity_id = ? AND state = 'running' ORDER BY started_at DESC LIMIT 1", [ctx.workspaceId, entityId]);
      return row ? hydrate(row) : null;
    },

    start(kind: JobKind, entity: { type: string; id: string }, actor: Actor): Job {
      const id = newId();
      const steps: JobStep[] = (JOB_STEPS[kind] ?? []).map((s) => ({ id: s.id, label: s.label, state: 'pending' as JobStepState, startedAt: null, endedAt: null }));
      ctx.db.insert('jobs', {
        id, workspaceId: ctx.workspaceId, kind, entityType: entity.type, entityId: entity.id, state: 'running',
        stepsJson: steps, logJson: [], logSeq: 0, requestedBy: actorString(actor), startedAt: nowIso(),
      });
      live.set(id, { lines: [], seq: 0, dirty: false, timer: null });
      const job = read(id);
      ctx.events.emit('job.started', 'job', id, { kind, entityType: entity.type, entityId: entity.id });
      log.info({ jobId: id, kind, entityId: entity.id }, 'job started');
      return job;
    },

    step(jobId: string, stepId: string, state: JobStepState): void {
      const job = read(jobId);
      const now = nowIso();
      const steps = job.steps.map((s) => {
        if (s.id !== stepId) return s;
        if (state === 'running') return { ...s, state, startedAt: now, endedAt: null };
        return { ...s, state, startedAt: s.startedAt ?? now, endedAt: now };
      });
      // A transition is the one moment the tail must be on the row: it is what a late reader sees.
      flush(jobId);
      ctx.db.update('jobs', jobId, { stepsJson: steps });
      publish({ kind: 'step', jobId, step: steps.find((s) => s.id === stepId) ?? { id: stepId, label: stepId, state, startedAt: now, endedAt: null }, seq: live.get(jobId)?.seq ?? job.logSeq });
    },

    line(jobId: string, stepId: string, stream: JobLogStream, text: string): void {
      const state = live.get(jobId) ?? { lines: read(jobId).log, seq: read(jobId).logSeq, dirty: false, timer: null };
      live.set(jobId, state);
      state.seq += 1;
      const line: JobLogLine = { seq: state.seq, step: stepId, stream, text };
      state.lines.push(line);
      if (state.lines.length > JOB_LOG_LINES) state.lines.splice(0, state.lines.length - JOB_LOG_LINES);
      state.dirty = true;
      if (!state.timer) state.timer = setTimeout(() => flush(jobId), JOB_LOG_FLUSH_MS);
      publish({ kind: 'log', jobId, line, seq: line.seq });
    },

    finish(jobId: string, state: Exclude<JobState, 'running'>, extra: { failedStep?: string | null; message?: string | null } = {}): Job {
      const before = read(jobId);
      if (isTerminalJob(before.state)) return before;
      flush(jobId);
      ctx.db.update('jobs', jobId, {
        state, finishedAt: nowIso(),
        failedStep: extra.failedStep ?? null, message: extra.message ? extra.message.slice(0, 2000) : null,
      });
      forget(jobId);
      const job = read(jobId);
      ctx.events.emit('job.finished', 'job', jobId, { kind: job.kind, entityType: job.entityType, entityId: job.entityId, state, failedStep: job.failedStep });
      publish({ kind: 'finished', jobId, job, seq: job.logSeq });
      log.info({ jobId, state, failedStep: job.failedStep }, 'job finished');
      return job;
    },

    onItem(handler: (item: JobStreamItem) => void): () => void {
      emitter.on('item', handler);
      return () => emitter.off('item', handler);
    },

    /**
     * Startup: a job still `running` belongs to a process that is gone. Nothing resumes it — the
     * entity it was acting on is left in the state its owner can retry.
     */
    reconcile(): void {
      const orphans = ctx.db.all<Job>("SELECT * FROM jobs WHERE workspace_id = ? AND state = 'running'", [ctx.workspaceId]);
      for (const job of orphans) {
        const failedStep = job.steps.find((s) => s.state === 'running')?.id ?? null;
        ctx.db.update('jobs', job.id, {
          state: 'failed', finishedAt: nowIso(), failedStep,
          message: 'the daemon stopped while this was running',
          stepsJson: job.steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed', endedAt: nowIso() } : s)),
        });
        log.warn({ jobId: job.id, kind: job.kind, entityId: job.entityId }, 'job left running by a previous process; failed');
      }
    },
  };

  return service;
}
