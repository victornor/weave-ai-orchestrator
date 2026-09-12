import { EventEmitter } from 'node:events';
import type { InputDelivery } from '@weave-ai/runtime-sdk';
import { nowIso } from '@weave-ai/db';
import type { Agent, AuthorKind, RunEvent } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';

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
  emitter: EventEmitter;
  stopping: boolean;
}

const states = new WeakMap<WorkspaceContext, RunRuntimeState>();

/** Per-workspace in-memory view of runs currently executing in this process. */
export function runState(ctx: WorkspaceContext): RunRuntimeState {
  let s = states.get(ctx);
  if (!s) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(500);
    s = { active: new Map(), emitter, stopping: false };
    states.set(ctx, s);
  }
  return s;
}

export function emitRunEvent(ctx: WorkspaceContext, runId: string, ev: RunEvent): void {
  runState(ctx).emitter.emit('event', runId, ev);
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
 */
export function describeLiveInput(ctx: WorkspaceContext, agent: Pick<Agent, 'id' | 'runtimeId'>): LiveInputStatus {
  const runtime = ctx.registries.runtimes.get(agent.runtimeId);
  if (!runtime?.capabilities.streamingInput) {
    for (const active of runState(ctx).active.values()) {
      if (active.agentId === agent.id) return { midTurn: false, interrupts: true };
    }
    return { midTurn: false, reason: `${runtime?.displayName ?? agent.runtimeId} does not support delivering input to a turn that is already running` };
  }
  for (const active of runState(ctx).active.values()) {
    if (active.agentId === agent.id && active.send) return { midTurn: true };
  }
  return { midTurn: false, reason: 'no turn is currently running for this agent' };
}
