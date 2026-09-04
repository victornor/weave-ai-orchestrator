import { EventEmitter } from 'node:events';
import type { RunEvent } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';

export interface ActiveRun {
  runId: string;
  agentId: string;
  startedAt: number;
  pid: number | null;
  cancel(mode: 'interrupt' | 'kill'): Promise<void>;
  cancelled?: 'interrupt' | 'kill';
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
