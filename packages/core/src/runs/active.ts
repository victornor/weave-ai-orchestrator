import { EventEmitter } from 'node:events';
import type { InputDelivery } from '@weave-ai/runtime-sdk';
import { nowIso } from '@weave-ai/db';
import type { Agent, AuthorKind, RunEvent } from '@weave-ai/shared';
import type { Actor, CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import type { PartialBuffer } from './partials.js';

export interface ActiveRun {
  runId: string;
  agentId: string;
  startedAt: number;
  pid: number | null;
  cancel(mode: 'interrupt' | 'kill'): Promise<void>;
  /** `cause: 'message'` (VS-254) is a human's live message on a runtime that cannot take mid-turn
   * input; omitted is everything else (daemon shutdown, `/runs/:id/cancel`) — `finalize()` reads
   * this to set a distinguishing `errorCode`, never the reverse. */
  cancelled?: { mode: 'interrupt' | 'kill'; cause?: 'message' };
  /** Deliver text to this turn while it runs. Absent until the runtime hands a `send`-carrying handle. */
  send?: (text: string) => Promise<InputDelivery>;
}

export interface RunRuntimeState {
  active: Map<string, ActiveRun>;
  /** VS-595: the partial output of each live run, for `GET /runs/:id/live`. */
  partials: Map<string, PartialBuffer>;
  emitter: EventEmitter;
  stopping: boolean;
  /**
   * VS-339: set synchronously when the daemon begins shutting down or draining, before any child
   * process can be signalled, and cleared by `dispatcher.start()`. `finalize()` reads it to tell a
   * turn cut off by the shutdown from a genuine failure, whatever the child's exit code says.
   */
  shuttingDown: { reason: string; at: string } | null;
}

const states = new WeakMap<WorkspaceContext, RunRuntimeState>();

/** Per-workspace in-memory view of runs currently executing in this process. */
export function runState(ctx: WorkspaceContext): RunRuntimeState {
  let s = states.get(ctx);
  if (!s) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(500);
    s = { active: new Map(), partials: new Map(), emitter, stopping: false, shuttingDown: null };
    states.set(ctx, s);
  }
  return s;
}

export function emitRunEvent(ctx: WorkspaceContext, runId: string, ev: RunEvent): void {
  runState(ctx).emitter.emit('event', runId, ev);
  // VS-417: also hand the event to the workspace event stream as a live-only `run.event` frame, so
  // every run a surface is watching shares that stream instead of opening an `EventSource` per run.
  // Ephemeral (no outbox row): a client that misses one re-reads the run's persisted events.
  try {
    ctx.events.broadcast('run.event', 'run', runId, { runId, event: ev });
  } catch (e) {
    ctx.log('run').warn({ runId, err: String(e) }, 'run event broadcast failed');
  }
}

/**
 * Record a human's message to an agent as a `human.input` event on the named run (VS-99) — from
 * outside the engine's own turn, so it computes its `seq` fresh off the table rather than sharing a
 * counter with a turn that may be writing to the same run concurrently (the same pattern the
 * supervisor uses for `supervisor.action`). Persists to `run_events` and emits live, exactly like
 * the engine's own events, so it appears in the live view and in every existing transcript reader.
 */
export function recordHumanInputEvent(
  ctx: WorkspaceContext,
  runId: string,
  payload: { text: string; authorKind: AuthorKind; authorId: string | null; delivery: 'mid_turn' | 'queued' | 'interrupted' },
): void {
  const seq = (ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(seq),0) n FROM run_events WHERE run_id = ?', [runId])?.n ?? 0) + 1;
  const ts = nowIso();
  ctx.db.run(
    'INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)',
    [runId, seq, ts, 'human.input', 'system', 'info', JSON.stringify(payload)],
  );
  ctx.db.run('UPDATE runs SET last_event_at = ? WHERE id = ?', [ts, runId]);
  emitRunEvent(ctx, runId, { id: String(seq), runId, seq, ts, type: 'human.input', stream: 'system', level: 'info', payload });
}

/**
 * What `GET /workers/:id` reports about mid-turn delivery for one agent (VS-99): not a guess — a
 * runtime that cannot take it, or the plain fact that nothing is running right now. `interrupts`
 * (VS-254) is a third outcome: the runtime cannot take mid-turn input, but a turn is running, so a
 * human's live send would interrupt it rather than queue behind it.
 */
export interface LiveInputStatus { midTurn: boolean; interrupts?: boolean; reason?: string }

/**
 * Whether a human's next message to this agent would reach a running turn, interrupt one, or queue:
 * `midTurn` needs the runtime to declare `streamingInput` and a run for this agent to be executing
 * with a channel actually open (a runtime capability alone is not enough — the turn also has to be
 * the kind that opened one, per `defaults.liveInput`); short of that, `interrupts` is true whenever a
 * turn for this agent is executing at all — a runtime without `streamingInput` never has `.send`, so
 * that running turn is always a candidate to interrupt rather than queue behind (VS-254). Read-only;
 * never spawns anything, never blocks.
 *
 * VS-657: a ticketless persistent session always interrupts, even on a runtime that carries `send` —
 * the ask is that a message stops the running turn and resumes with it, not that it injects text.
 */
export function describeLiveInput(ctx: WorkspaceContext, agent: Pick<Agent, 'id' | 'runtimeId' | 'kind' | 'ticketId'>): LiveInputStatus {
  const running = [...runState(ctx).active.values()].some((r) => r.agentId === agent.id);
  if (agent.kind === 'session' && !agent.ticketId) {
    return running ? { midTurn: false, interrupts: true } : { midTurn: false, reason: 'no turn is currently running for this agent' };
  }
  const runtime = ctx.registries.runtimes.get(agent.runtimeId);
  if (!runtime?.capabilities.streamingInput) {
    return running
      ? { midTurn: false, interrupts: true }
      : { midTurn: false, reason: `${runtime?.displayName ?? agent.runtimeId} does not support delivering input to a turn that is already running` };
  }
  for (const active of runState(ctx).active.values()) {
    if (active.agentId === agent.id && active.send) return { midTurn: true };
  }
  return { midTurn: false, reason: 'no turn is currently running for this agent' };
}

/** VS-662: the run currently executing for this agent in this process, if any. Read-only. */
export function activeRunFor(ctx: WorkspaceContext, agentId: string): ActiveRun | null {
  for (const active of runState(ctx).active.values()) if (active.agentId === agentId) return active;
  return null;
}

/**
 * VS-662: the run a **steer** to this agent should interrupt, or null when nothing should be
 * interrupted. A steer is the words a human or the conductor sends to direct a ticket-bound worker's
 * work; interrupting is scoped to such a worker (never the weaver, never a ticketless session) with a
 * turn executing, and is skipped while that turn is already stopping for an earlier steer — so a
 * second rapid steer coalesces into the one resumed turn rather than cancelling again.
 *
 * Synchronous and read-only, so a caller inside `tx` (which forbids awaiting) can compute the run id
 * for its wake payload before the transaction commits; `interruptRunForSteer` performs the cancel.
 */
export function steerInterruptTarget(ctx: WorkspaceContext, agentId: string): string | null {
  const agent = ctx.db.get<{ kind: string; ticketId: string | null }>(
    'SELECT kind, ticket_id AS ticketId FROM agents WHERE id = ? AND workspace_id = ?',
    [agentId, ctx.workspaceId],
  );
  if (!agent || !agent.ticketId || agent.kind === 'weaver') return null;
  const active = activeRunFor(ctx, agentId);
  if (!active || active.cancelled?.cause === 'message') return null;
  return active.runId;
}

/**
 * VS-662: interrupt a running ticket worker's turn to deliver a steer. Best effort and never throws:
 * the steer's wake is already queued by the caller, and `finalize` records the cut as
 * `interrupted_by_message`, after which the worker resumes on that wake.
 */
export function interruptRunForSteer(ctx: WorkspaceContext, deps: () => CoreServices, actor: Actor, runId: string): void {
  void deps().runs.cancel(actor, runId, 'interrupt', 'message')
    .catch((e) => ctx.log('run').warn({ runId, err: String(e) }, 'interrupting a turn for a steer failed'));
}
