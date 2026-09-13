/**
 * `WorkerActivityService` (VS-328) — what a live worker is doing right now, and the tally of its most
 * recent test command, held in memory and pushed onto the workspace stream the board already consumes.
 *
 * The run engine feeds every recorded event here. Activity is set only by live events and cleared when
 * the run finalizes; the test tally is kept across turns until a newer test command replaces it, and
 * rebuilt (bounded) from the worker's persisted events when this process has just started and holds
 * nothing for it.
 */
import type { RunEvent, WorkerActivitySummary } from '@weave-ai/shared';
import type { TestTally } from '@weave-ai/shared';
import { workerActivity } from '@weave-ai/render';
import type { WorkspaceContext } from '../context.js';

/** At most one pushed update per worker per window, however busy the turn is. */
export const ACTIVITY_PUSH_MS = 2000;
/** The lazy rebuild reads at most this many of the worker's newest runs… */
export const ACTIVITY_REBUILD_RUNS = 5;
/** …and at most this many of their command events in total. */
export const ACTIVITY_REBUILD_EVENTS = 200;

export interface WorkerActivityService {
  /** Fold one recorded run event into a worker's summary. Called by the run engine. */
  observe(agentId: string, ticketId: string | null, event: RunEvent): void;
  /** The run ended: drop the activity line, keep the tally, and push the result. */
  finish(agentId: string): void;
  /** The current summary for a worker, or null when it has none (rebuilding the tally if needed). */
  summaryFor(agentId: string): WorkerActivitySummary | null;
}

interface Entry {
  ticketId: string | null;
  activity: { verb: string; label: string; target: string | null; since: string } | null;
  tests: TestTally | null;
  lastPushAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const tallyOf = (event: RunEvent): TestTally | null => {
  if (event.type !== 'command.executed') return null;
  const t = event.payload['tests'];
  if (!t || typeof t !== 'object') return null;
  const { passed, total } = t as { passed?: unknown; total?: unknown };
  if (typeof passed !== 'number' || typeof total !== 'number') return null;
  return { passed, total };
};

export function createWorkerActivityService(ctx: WorkspaceContext): WorkerActivityService {
  const entries = new Map<string, Entry>();
  /** Workers whose rebuild found no tally, so a read does not rescan them. */
  const rebuiltMisses = new Set<string>();

  const ensure = (agentId: string, ticketId: string | null): Entry => {
    let e = entries.get(agentId);
    if (!e) {
      e = { ticketId, activity: null, tests: null, lastPushAt: 0, timer: null };
      entries.set(agentId, e);
    } else if (ticketId) {
      e.ticketId = ticketId;
    }
    return e;
  };

  const summaryOf = (agentId: string, e: Entry): WorkerActivitySummary => ({ agentId, ticketId: e.ticketId, activity: e.activity, tests: e.tests });

  const push = (agentId: string): void => {
    const e = entries.get(agentId);
    if (!e) return;
    e.lastPushAt = Date.now();
    try {
      ctx.events.broadcast('worker.activity', 'worker', agentId, summaryOf(agentId, e));
    } catch (err) {
      ctx.log('run').warn({ agentId, err: String(err) }, 'worker activity broadcast failed');
    }
  };

  const schedule = (agentId: string): void => {
    const e = entries.get(agentId)!;
    const wait = ACTIVITY_PUSH_MS - (Date.now() - e.lastPushAt);
    if (wait <= 0) {
      push(agentId);
      return;
    }
    if (e.timer) return;
    e.timer = setTimeout(() => {
      e.timer = null;
      push(agentId);
    }, wait);
    e.timer.unref?.();
  };

  /**
   * The most recent test tally on a worker's newest runs, read from persisted `command.executed`
   * payloads. Bounded by run and event counts so the workers read stays cheap after a restart, and
   * cached on the entry once attempted.
   */
  const rebuildTests = (agentId: string): TestTally | null => {
    const runs = ctx.db.all<{ id: string }>(
      'SELECT id FROM runs WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      [agentId, ACTIVITY_REBUILD_RUNS],
    );
    let remaining = ACTIVITY_REBUILD_EVENTS;
    for (const run of runs) {
      if (remaining <= 0) break;
      const events = ctx.db.all<{ payloadJson: string }>(
        "SELECT payload_json AS payloadJson FROM run_events WHERE run_id = ? AND type = 'command.executed' ORDER BY seq DESC LIMIT ?",
        [run.id, remaining],
      );
      remaining -= events.length;
      for (const ev of events) {
        try {
          const payload = JSON.parse(ev.payloadJson) as { tests?: unknown };
          const t = payload.tests;
          if (t && typeof t === 'object') {
            const { passed, total } = t as { passed?: unknown; total?: unknown };
            if (typeof passed === 'number' && typeof total === 'number') return { passed, total };
          }
        } catch { /* a malformed payload simply yields no tally */ }
      }
    }
    return null;
  };

  return {
    observe(agentId, ticketId, event) {
      const line = workerActivity(event);
      const e = ensure(agentId, ticketId);
      let changed = false;
      if (line) {
        const same = e.activity && e.activity.verb === line.verb && e.activity.label === line.label && e.activity.target === line.target;
        if (!same) changed = true;
        e.activity = { verb: line.verb, label: line.label, target: line.target, since: same ? e.activity!.since : event.ts };
      }
      const tally = tallyOf(event);
      if (tally && (!e.tests || e.tests.passed !== tally.passed || e.tests.total !== tally.total)) {
        e.tests = tally;
        changed = true;
      }
      if (changed) schedule(agentId);
    },
    finish(agentId) {
      const e = entries.get(agentId);
      if (!e) return;
      e.activity = null;
      if (e.timer) { clearTimeout(e.timer); e.timer = null; }
      e.lastPushAt = 0;
      push(agentId);
    },
    summaryFor(agentId) {
      const e = entries.get(agentId);
      if (e) return summaryOf(agentId, e);
      if (rebuiltMisses.has(agentId)) return null;
      const rebuilt = rebuildTests(agentId);
      if (!rebuilt) {
        rebuiltMisses.add(agentId);
        return null;
      }
      const fresh = ensure(agentId, null);
      fresh.tests = rebuilt;
      return summaryOf(agentId, fresh);
    },
  };
}
