import { EventEmitter } from 'node:events';
import type { InputDelivery } from '@agent-conductor/runtime-sdk';
import { nowIso } from '@agent-conductor/db';
import type { Agent, AuthorKind, RunEvent } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';

export interface ActiveRun {
  runId: string;
  agentId: string;
  startedAt: number;
  pid: number | null;
  cancel(mode: 'interrupt' | 'kill'): Promise<void>;
  cancelled?: 'interrupt' | 'kill';
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
  payload: { text: string; authorKind: AuthorKind; authorId: string | null; delivery: 'mid_turn' | 'queued' },
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

/** What `GET /workers/:id` reports about mid-turn delivery for one agent (VS-99): not a guess — a runtime that cannot take it, or the plain fact that nothing is running right now. */
export interface LiveInputStatus { midTurn: boolean; reason?: string }

/**
 * Whether a human's next message to this agent would reach a running turn: the runtime has to
 * declare `streamingInput`, and a run for this agent has to be executing with a channel actually
 * open (a runtime capability alone is not enough — the turn also has to be the kind that opened
 * one, per `defaults.liveInput`). Read-only; never spawns anything, never blocks.
 */
export function describeLiveInput(ctx: WorkspaceContext, agent: Pick<Agent, 'id' | 'runtimeId'>): LiveInputStatus {
  const runtime = ctx.registries.runtimes.get(agent.runtimeId);
  if (!runtime?.capabilities.streamingInput) {
    return { midTurn: false, reason: `${runtime?.displayName ?? agent.runtimeId} does not support delivering input to a turn that is already running` };
  }
  for (const active of runState(ctx).active.values()) {
    if (active.agentId === agent.id && active.send) return { midTurn: true };
  }
  return { midTurn: false, reason: 'no turn is currently running for this agent' };
}
