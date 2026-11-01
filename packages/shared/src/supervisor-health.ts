/**
 * VS-952: what a workspace supervisor reports about itself on `/api/health`, and the pure rule that
 * turns those readings into a `SupervisorState`. Nothing here depends on a wake, an event or a run
 * having happened — a quiet workspace and a stalled one are told apart from the tick's own clock.
 */
import type { SupervisorState } from './enums.js';

/** A supervisor step still pending past its timeout, and how long it has been in flight. */
export interface SupervisorStepInFlight { step: string; sinceMs: number }

/** The `supervisor` block of one workspace on `/api/health`. Counts and ages only: the route is unauthenticated. */
export interface SupervisorHealth {
  state: SupervisorState;
  startedAt: string | null;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  stepsInFlight: SupervisorStepInFlight[];
  lastWakeAt: string | null;
  activeRuns: number;
  queuedWakes: number;
  openHumanDecisions: number;
  /** Age of the oldest open human-owned decision, measured from when it became the human's to answer. */
  oldestHumanDecisionAgeMs: number | null;
}

/** No tick finished for this long (since start, or since the last finished tick) is a stall. */
export const SUPERVISOR_STALL_NO_TICK_MS = 10 * 60_000;
/** One step pending this long is a stall: it is skipped on every tick until it settles. */
export const SUPERVISOR_STALL_STEP_MS = 30 * 60_000;

export interface SupervisorStateInput {
  now: number;
  /** When the supervisor's timer started, or null while it is not running. */
  startedAt: number | null;
  lastTickFinishedAt: number | null;
  stepsInFlight: SupervisorStepInFlight[];
  activeRuns: number;
  queuedWakes: number;
  openHumanDecisions: number;
}

/** The first state in `SUPERVISOR_STATES` order whose condition holds. */
export function supervisorState(i: SupervisorStateInput): SupervisorState {
  if (i.startedAt !== null) {
    const since = i.lastTickFinishedAt ?? i.startedAt;
    if (i.now - since >= SUPERVISOR_STALL_NO_TICK_MS) return 'stalled';
    if (i.stepsInFlight.some((s) => s.sinceMs >= SUPERVISOR_STALL_STEP_MS)) return 'stalled';
  }
  if (i.lastTickFinishedAt === null) return 'starting';
  if (i.activeRuns > 0 || i.queuedWakes > 0) return 'active';
  if (i.openHumanDecisions > 0) return 'idle_waiting_on_human';
  return 'idle';
}
