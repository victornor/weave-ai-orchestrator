/**
 * What a conductor turn left in the chat, rendered as items of the message list under the message
 * that turn produced: the work it filed (spec `conductor-chat/dispatch-labels`) and the decisions it
 * raised for the human (spec `human-decisions/option-cards`).
 *
 * A dispatch anchors on a run: the conductor does not spawn workers — it files a ticket and the
 * supervisor spawns for it, outside any run — so a dispatch is attributed to the run that created
 * its ticket, matched against the run behind an outbound message in the thread.
 *
 * A decision anchors on the message that carried its card, by the card part's `ref.id`, before the
 * run that raised it (VS-309). The channel manager pushes every human-owned decision to the thread
 * as a card message, and that message is the decision's own durable home; the raising run is only a
 * fallback, because most decisions (every worker's) have no message of their own.
 */
import type { Agent, AgentStatus, Decision, RunTrace, Ticket, ThreadMessage, UiStatus } from '@weave-ai/shared';
import { agentUiStatus, isActiveRun, ticketUiStatus } from '@weave-ai/shared';
import { decisionCardPartsOf } from '@weave-ai/render';
import { ticketIdentifiersIn } from './ticketLinks';

/** A worker in one of these has stopped; the ticket is then the honest record of how the work ended. */
const FINISHED: readonly AgentStatus[] = ['done', 'retired'];

export interface Dispatch {
  ticket: Ticket;
  /** The worker on the ticket, or null before the supervisor has spawned one. */
  worker: Agent | null;
  status: UiStatus;
}

export interface ChatEntry {
  message: ThreadMessage;
  /** Dispatches anchored to this message, in the order their tickets were filed. */
  dispatches: Dispatch[];
  /**
   * VS-634: every ticket the message references, de-duplicated and in the order the message first
   * mentions them — the identifiers in its body, then the dispatches it filed but did not name.
   * Empty for a message that names no ticket.
   */
  references: Dispatch[];
  /** Decisions the run behind this message raised, in the order they were raised. */
  decisions: Decision[];
}

export interface ChatEntries {
  entries: ChatEntry[];
  /** Live workers no message in the thread accounts for; they keep the row below the conversation. */
  unattributed: Agent[];
}

/**
 * The dispatch's state: the worker while it is still live, the ticket once it is not. `agentUiStatus`
 * maps both `done` and `retired` to `done`, so a retired worker alone would claim success on a
 * cancelled ticket; and a ticket alone cannot say that its worker is mid-turn right now.
 */
export function dispatchStatus(ticket: Ticket, worker: Agent | null): UiStatus {
  if (worker && !FINISHED.includes(worker.status)) return agentUiStatus(worker.status);
  return ticketUiStatus(ticket.status);
}

/** Run id → the last outbound message that run produced: where that turn's account of itself ends. */
function anchors(messages: ThreadMessage[]): Map<string, string> {
  const byRun = new Map<string, string>();
  for (const m of messages) if (m.direction === 'outbound' && m.runId) byRun.set(m.runId, m.id);
  return byRun;
}

/** The worker to show for a ticket: the live one, else the most recently created of the finished ones. */
function workerFor(ticketId: string, workers: Agent[]): Agent | null {
  let best: Agent | null = null;
  for (const w of workers) {
    if (w.ticketId !== ticketId) continue;
    if (!best) { best = w; continue; }
    const liveBeat = !FINISHED.includes(w.status) && FINISHED.includes(best.status);
    const sameLiveness = FINISHED.includes(w.status) === FINISHED.includes(best.status);
    if (liveBeat || (sameLiveness && w.createdAt > best.createdAt)) best = w;
  }
  return best;
}

/** A ticket is a dispatch once it is, or has been, assigned to a role; one filed for later is not. */
function isDispatched(t: Ticket): boolean {
  return Boolean(t.assigneeRoleId ?? t.workerId);
}

/**
 * VS-634: the tickets one message references, for the strip under it. The identifiers in the message
 * body come first, in the order they are first mentioned; a ticket a dispatch filed but the message
 * did not name follows, in the order its dispatch was recorded. An identifier with no ticket in the
 * workspace is silently skipped, and each ticket appears once.
 */
function referencesFor(
  message: ThreadMessage,
  dispatches: Dispatch[],
  byIdentifier: Map<string, Ticket>,
  workers: Agent[],
): Dispatch[] {
  const references: Dispatch[] = [];
  const seen = new Set<string>();
  if (message.direction === 'outbound') {
    for (const identifier of ticketIdentifiersIn(message.body)) {
      const ticket = byIdentifier.get(identifier);
      if (!ticket || seen.has(ticket.id)) continue;
      seen.add(ticket.id);
      const worker = workerFor(ticket.id, workers);
      references.push({ ticket, worker, status: dispatchStatus(ticket, worker) });
    }
  }
  for (const dispatch of dispatches) {
    if (seen.has(dispatch.ticket.id)) continue;
    seen.add(dispatch.ticket.id);
    references.push(dispatch);
  }
  return references;
}

/**
 * The chat's ordered entries: every message, each followed by the dispatches anchored to it, plus the
 * live work no message accounts for. Everything is derived from persisted fields, so a reload rebuilds
 * the same entries in the same order.
 */
export function chatEntries(messages: ThreadMessage[], tickets: Ticket[], workers: Agent[], decisions: Decision[] = []): ChatEntries {
  const byRun = anchors(messages);
  const byMessage = new Map<string, Dispatch[]>();

  const dispatched = tickets
    .filter((t) => t.createdRunId && isDispatched(t) && byRun.has(t.createdRunId))
    .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));

  for (const ticket of dispatched) {
    const messageId = byRun.get(ticket.createdRunId!)!;
    const worker = workerFor(ticket.id, workers);
    const list = byMessage.get(messageId) ?? [];
    list.push({ ticket, worker, status: dispatchStatus(ticket, worker) });
    byMessage.set(messageId, list);
  }

  // A decision's own message is the one whose card names it, by `ref.id`; the run that raised it is
  // the fallback for a message shape with no card part. That is what lets an answered decision whose
  // raising run left no message still read under the message it was pushed as. A decision with
  // neither anchor is not part of the conversation: while it is open the chat pins it from the
  // decisions query, and once answered it is not rendered.
  const cardAnchors = new Map<string, string>();
  for (const message of messages) {
    for (const part of decisionCardPartsOf(message.parts)) {
      if (!cardAnchors.has(part.ref.id)) cardAnchors.set(part.ref.id, message.id);
    }
  }

  const decisionsByMessage = new Map<string, Decision[]>();
  for (const decision of [...decisions].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  )) {
    const messageId = cardAnchors.get(decision.id) ?? (decision.askedInRunId ? byRun.get(decision.askedInRunId) : undefined);
    if (!messageId) continue;
    const list = decisionsByMessage.get(messageId) ?? [];
    list.push(decision);
    decisionsByMessage.set(messageId, list);
  }

  const byIdentifier = new Map(tickets.map((t) => [t.identifier, t] as const));
  const entries: ChatEntry[] = messages.map((message) => {
    const dispatches = byMessage.get(message.id) ?? [];
    return {
      message,
      dispatches,
      references: referencesFor(message, dispatches, byIdentifier, workers),
      decisions: decisionsByMessage.get(message.id) ?? [],
    };
  });

  // VS-634: a worker is unaccounted for only when no message in the thread chips its ticket —
  // whether that ticket was dispatched by a turn or merely named in a reply.
  const chipped = new Set<string>();
  for (const entry of entries) for (const reference of entry.references) chipped.add(reference.ticket.id);

  return {
    entries,
    unattributed: workers.filter((w) => !FINISHED.includes(w.status) && !(w.ticketId && chipped.has(w.ticketId))),
  };
}

/**
 * What the chat renders, in order: the conversation, and the turns that left no message in it.
 *
 * A finished conductor turn is worth a row whether or not it spoke — the wake that only filed a
 * ticket did something, and a history that shows nothing for it reads as if nothing happened. Its
 * work goes with its reply where there is one and stands alone where there is not, so the same
 * trace is never rendered twice.
 */
export type ChatRow =
  | { kind: 'message'; key: string; entry: ChatEntry; trace: RunTrace | null }
  | { kind: 'trace'; key: string; trace: RunTrace };

/** When a turn happened, for ordering it against the messages. Its end, or its start if it has none. */
function traceAt(trace: RunTrace): string {
  return trace.finishedAt ?? trace.startedAt ?? trace.createdAt;
}

/** Nothing a transcript would render: bookkeeping events alone are not a trace worth offering. */
export function traceIsEmpty(trace: RunTrace): boolean {
  return trace.toolCalls + trace.files + trace.errors + trace.texts === 0;
}

/**
 * Messages and trace-only rows, ordered by time.
 *
 * A trace goes to the *last* message of its run, the same anchor the dispatches and decisions use,
 * so a turn that sent two messages accounts for itself once. A run still in flight never becomes a
 * row: the live view is already showing it, and a second copy of the same turn is exactly what this
 * is meant to avoid. `showSilent` hides the standalone rows without touching the anchored traces.
 */
export function chatRows(
  entries: ChatEntry[],
  traces: readonly RunTrace[],
  { showSilent = true }: { showSilent?: boolean } = {},
): ChatRow[] {
  const byRun = new Map<string, RunTrace>();
  for (const t of traces) byRun.set(t.runId, t);

  /** Run id → the last message it produced, so an earlier message of the same turn carries nothing. */
  const anchor = new Map<string, string>();
  for (const { message } of entries) {
    if (message.direction === 'outbound' && message.runId) anchor.set(message.runId, message.id);
  }

  const rows: ChatRow[] = entries.map((entry) => {
    const runId = entry.message.runId;
    const own = runId && anchor.get(runId) === entry.message.id ? byRun.get(runId) ?? null : null;
    return { kind: 'message', key: entry.message.id, entry, trace: own && !traceIsEmpty(own) ? own : null };
  });

  if (showSilent) {
    for (const trace of traces) {
      if (anchor.has(trace.runId) || isActiveRun(trace.status) || traceIsEmpty(trace)) continue;
      rows.push({ kind: 'trace', key: `trace:${trace.runId}`, trace });
    }
  }

  // Stable: messages already arrive in order, and two things recorded in the same millisecond keep
  // whichever order their ids give them rather than swapping between renders.
  const at = (r: ChatRow): string => (r.kind === 'message' ? r.entry.message.createdAt : traceAt(r.trace));
  return rows.sort((a, b) => (at(a) === at(b) ? a.key.localeCompare(b.key) : at(a).localeCompare(at(b))));
}
