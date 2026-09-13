/**
 * Run inspection for the conductor (VS-61, `worker-supervision/run-inspection`).
 *
 * Read-only: resolves a ticket, worker or run reference to a run, derives which phase it is in,
 * and renders a bounded slice of its transcript. Everything it shows already exists — the run
 * engine recorded it and `@weave-ai/render` folds and redacts it, the same way the run page
 * and `weave attach` do, so an inspected transcript cannot disagree with the one a human sees.
 */
import { RECORDED_RUN_PHASES, OcError, type Agent, type Run, type RunEvent, type RunPhase, type Ticket } from '@weave-ai/shared';
import { formatDuration, runEventsToTranscript, transcriptToLines, type InspectionLine } from '@weave-ai/render';
import type { CoreServices } from '@weave-ai/core';

/** Transcript events read per call. The tool caps the caller's request at `MAX_EVENTS`. */
export const DEFAULT_EVENTS = 40;
export const MAX_EVENTS = 200;
/** Hard ceiling on the encoded response, so a runaway transcript cannot flood a context window. */
export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const DEFAULT_RUN_LIST = 10;
export const MAX_RUN_LIST = 50;

export type RefKind = 'ticket' | 'worker' | 'run';

export interface ResolvedRef {
  kind: RefKind;
  /** The ticket, worker or run the reference named. */
  id: string;
  ticket: Ticket | null;
  worker: Agent | null;
  run: Run | null;
}

export interface PhaseView {
  /** The phase under way, or null once the run is no longer active. */
  current: RunPhase | null;
  completed: Array<{ phase: string; durationMs: number | null }>;
}

export interface TranscriptCursor {
  totalEvents: number;
  firstSeq: number | null;
  lastSeq: number | null;
  truncated: boolean;
  /** Pass as `since` to continue forward. Null when this response already reached the newest event. */
  resumeFrom: number | null;
  /** Events before `firstSeq` this response did not cover. Page back with a lower `since`. */
  omittedBefore: number;
  note: string | null;
}

const safe = <T>(fn: () => T): T | null => { try { return fn(); } catch { return null; } };

// ---------- reference resolution ----------

/**
 * A ticket identifier, a ticket id, a worker id or a run id → the run to inspect.
 *
 * Ids are ULIDs from one space, so the kinds cannot be told apart by shape: each lookup is tried in
 * turn and the first hit wins. A ticket or worker resolves to its newest run — `runs.list` orders by
 * creation descending, so that is the running one whenever one is running.
 */
export function resolveRunRef(svc: CoreServices, ref: string): ResolvedRef {
  const ticket = safe(() => svc.tickets.get(ref));
  if (ticket) {
    return { kind: 'ticket', id: ticket.id, ticket, worker: latestWorkerFor(svc, ticket), run: newestRun(svc, { ticketId: ticket.id }) };
  }

  const worker = safe(() => svc.workers.get(ref));
  if (worker) {
    const run = newestRun(svc, { agentId: worker.id });
    return { kind: 'worker', id: worker.id, ticket: worker.ticketId ? safe(() => svc.tickets.get(worker.ticketId!)) : null, worker, run };
  }

  const run = safe(() => svc.runs.get(ref));
  if (run) {
    return {
      kind: 'run', id: run.id,
      ticket: run.ticketId ? safe(() => svc.tickets.get(run.ticketId!)) : null,
      worker: safe(() => svc.workers.get(run.agentId)),
      run,
    };
  }

  throw new OcError('not_found', `${ref} matches no ticket, worker or run in this workspace`);
}

function newestRun(svc: CoreServices, filter: { ticketId?: string; agentId?: string }): Run | null {
  return svc.runs.list({ ...filter, limit: 1 }).items[0] ?? null;
}

/** The worker on the ticket, or the one behind its newest run when the ticket no longer names one. */
function latestWorkerFor(svc: CoreServices, ticket: Ticket): Agent | null {
  if (ticket.workerId) {
    const w = safe(() => svc.workers.get(ticket.workerId!));
    if (w) return w;
  }
  const run = newestRun(svc, { ticketId: ticket.id });
  return run ? safe(() => svc.workers.get(run.agentId)) : null;
}

// ---------- phase ----------

const num = (p: Record<string, unknown> | null, ...keys: string[]): number | null => {
  if (!p) return null;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
};

/**
 * Which phase the run is in. The engine records a `run.phase.timing` when a phase *ends*, so the
 * phase under way is the one after the last recorded — walked over `RECORDED_RUN_PHASES`, the
 * phases the engine actually times, not `RUN_PHASES`, which also declares two it never emits.
 *
 * A phase the run skips — `prepare_worktree` for an agent with no worktree — still reads one step
 * early; the completed list is returned alongside so that is visible rather than implied.
 */
export function derivePhase(run: Run, timings: readonly RunEvent[]): PhaseView {
  const completed: PhaseView['completed'] = [];
  for (const ev of timings) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    const phase = typeof payload['phase'] === 'string' ? payload['phase'] : null;
    if (phase) completed.push({ phase, durationMs: num(payload, 'ms', 'durationMs', 'duration_ms') });
  }

  const active = run.status === 'running' || run.status === 'queued';
  if (!active) return { current: null, completed };

  const lastDone = completed.length ? completed[completed.length - 1]!.phase : null;
  if (!lastDone) return { current: RECORDED_RUN_PHASES[0] ?? null, completed };
  const idx = RECORDED_RUN_PHASES.indexOf(lastDone as RunPhase);
  return { current: idx >= 0 && idx + 1 < RECORDED_RUN_PHASES.length ? RECORDED_RUN_PHASES[idx + 1]! : null, completed };
}

// ---------- transcript window ----------

export interface WindowRequest {
  since?: number;
  full?: boolean;
  limit?: number;
}

/**
 * The events this call covers: the tail by default, forward from `since` when given, from the start
 * of the run when `full`. `limit` is already validated by the tool's schema.
 */
export function readWindow(svc: CoreServices, runId: string, req: WindowRequest): { events: RunEvent[]; mode: 'tail' | 'forward'; limit: number } {
  const limit = req.limit ?? (req.full ? MAX_EVENTS : DEFAULT_EVENTS);
  if (req.full) return { events: svc.runs.events(runId, 0, limit), mode: 'forward', limit };
  if (req.since !== undefined) return { events: svc.runs.events(runId, req.since, limit), mode: 'forward', limit };
  return { events: svc.runs.tail(runId, limit), mode: 'tail', limit };
}

/**
 * How many events the run recorded. Sequences are assigned `MAX(seq) + 1` from 1 and are contiguous
 * within a run, so the newest event's sequence is the count — one row instead of a scan.
 */
export function totalEventsOf(svc: CoreServices, runId: string): number {
  return svc.runs.tail(runId, 1)[0]?.seq ?? 0;
}

const sizeOf = (line: InspectionLine): number => JSON.stringify(line).length + 1;

/**
 * Hold the response under `maxBytes` by dropping whole entries — from the end of a forward read, so
 * `resumeFrom` continues where it stopped, and from the front of a tail read, so the newest survive.
 * An entry that alone exceeds the budget has its text cut, so the cap holds unconditionally.
 */
export function fitToBudget(lines: InspectionLine[], mode: 'tail' | 'forward', maxBytes = MAX_PAYLOAD_BYTES): { lines: InspectionLine[]; omittedBefore: number; cappedBySize: boolean } {
  const ordered = mode === 'tail' ? [...lines].reverse() : lines;
  const kept: InspectionLine[] = [];
  let used = 0;
  let cappedBySize = false;

  for (const line of ordered) {
    const size = sizeOf(line);
    if (used + size <= maxBytes) {
      kept.push(line);
      used += size;
      continue;
    }
    // Nothing fits yet: keep this one, shortened, rather than returning an empty transcript.
    if (kept.length === 0) {
      const room = Math.max(0, maxBytes - (size - line.text.length) - 1);
      if (room > 0) kept.push({ ...line, text: `${line.text.slice(0, room)}…` });
    }
    cappedBySize = true;
    break;
  }

  const out = mode === 'tail' ? kept.reverse() : kept;
  return { lines: out, omittedBefore: mode === 'tail' ? lines.length - out.length : 0, cappedBySize };
}

/** Render a window of run events into bounded lines, with the cursor that says how to continue. */
export function renderWindow(
  events: RunEvent[],
  mode: 'tail' | 'forward',
  limit: number,
  totalEvents: number,
): { transcript: InspectionLine[]; cursor: TranscriptCursor } {
  const rendered = transcriptToLines(runEventsToTranscript(events));
  const { lines, cappedBySize } = fitToBudget(rendered, mode);

  const lastEventSeq = events.length ? events[events.length - 1]!.seq : null;
  const firstSeq = lines.length ? lines[0]!.seq : null;
  const lastSeq = lines.length ? lines[lines.length - 1]!.seq : null;

  // Forward: the response stops mid-run when the event limit or the size cap cut it short, and
  // `resumeFrom` is the last sequence it actually rendered. A tail already ends at the newest
  // event, so there is nothing forward of it — what it misses is older, reached by a lower `since`.
  const covered = cappedBySize ? lastSeq : lastEventSeq;
  const moreAfter = mode === 'forward' && covered !== null && covered < totalEvents;
  // Sequences are contiguous from 1, so everything before the first entry rendered is what is missing.
  const omittedBefore = firstSeq === null ? totalEvents : firstSeq - 1;
  const truncated = moreAfter || omittedBefore > 0;

  const notes: string[] = [];
  if (omittedBefore > 0) notes.push(`${omittedBefore} earlier event(s) not shown — page back with a lower since`);
  if (moreAfter) notes.push(`call again with since=${covered} for what follows`);
  if (cappedBySize) notes.push('cut to stay under the size cap; ask for a smaller limit for more detail');

  return {
    transcript: lines,
    cursor: {
      totalEvents,
      firstSeq,
      lastSeq,
      truncated,
      resumeFrom: moreAfter ? covered : null,
      omittedBefore,
      note: notes.length ? `truncated: ${notes.join('; ')}` : null,
    },
  };
}

// ---------- views ----------

const elapsedMs = (run: Run, now: number): number | null => {
  if (!run.startedAt) return null;
  const from = Date.parse(run.startedAt);
  if (!Number.isFinite(from)) return null;
  const to = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Number.isFinite(to) && to >= from ? to - from : null;
};

export function runView(run: Run, now = Date.now()): Record<string, unknown> {
  const ms = elapsedMs(run, now);
  return {
    id: run.id,
    status: run.status,
    turn: run.turnEpoch,
    runtimeId: run.runtimeId,
    model: run.model,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedMs: ms,
    elapsed: ms === null ? null : formatDuration(ms),
    liveness: run.liveness,
    errorCode: run.errorCode,
    errorFamily: run.errorFamily,
    retryOfRunId: run.retryOfRunId,
    summary: run.summary,
  };
}

export function workerView(svc: CoreServices, worker: Agent | null, ticket: Ticket | null): Record<string, unknown> | null {
  if (!worker) return null;
  return {
    id: worker.id,
    name: worker.name,
    kind: worker.kind,
    status: worker.status,
    pauseReason: worker.pauseReason,
    errorText: worker.errorText,
    roleId: worker.roleId,
    role: worker.roleId ? safe(() => svc.roles.get(worker.roleId!).name) : null,
    projectId: worker.projectId,
    ticketId: worker.ticketId,
    ticket: ticket ? { id: ticket.id, identifier: ticket.identifier, title: ticket.title, status: ticket.status } : null,
    turnCount: worker.turnCount,
    lastRunAt: worker.lastRunAt,
    // VS-317: the worker's own scheduled wakeup, so a scheduled wait is not read as a stall.
    scheduledWake: scheduledWake(svc, worker.id),
  };
}

/** The worker's pending self-wake as `{ at, reason }`, or null — the shape every worker view shares. */
export function scheduledWake(svc: CoreServices, agentId: string): { at: string | null; reason: string } | null {
  const w = safe(() => svc.wake.pendingSelfWake(agentId));
  return w ? { at: w.notBefore, reason: w.reason } : null;
}
