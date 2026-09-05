/**
 * Dispatch labels for the conductor chat (spec `conductor-chat/dispatch-labels`): work the conductor
 * filed during a turn, rendered as an item of the message list under the message that turn produced.
 *
 * The link is the ticket's creating run. The conductor does not spawn workers — it files a ticket and
 * the supervisor spawns for it, outside any run — so the run a dispatch is attributed to is the one
 * that created its ticket, matched against the run behind an outbound message in the thread.
 */
import type { Agent, AgentStatus, Ticket, ThreadMessage, UiStatus } from '@agent-conductor/shared';
import { agentUiStatus, ticketUiStatus } from '@agent-conductor/shared';

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
 * The chat's ordered entries: every message, each followed by the dispatches anchored to it, plus the
 * live work no message accounts for. Everything is derived from persisted fields, so a reload rebuilds
 * the same entries in the same order.
 */
export function chatEntries(messages: ThreadMessage[], tickets: Ticket[], workers: Agent[]): ChatEntries {
  const byRun = anchors(messages);
  const byMessage = new Map<string, Dispatch[]>();
  const anchored = new Set<string>();

  const dispatched = tickets
    .filter((t) => t.createdRunId && isDispatched(t) && byRun.has(t.createdRunId))
    .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));

  for (const ticket of dispatched) {
    const messageId = byRun.get(ticket.createdRunId!)!;
    const worker = workerFor(ticket.id, workers);
    const list = byMessage.get(messageId) ?? [];
    list.push({ ticket, worker, status: dispatchStatus(ticket, worker) });
    byMessage.set(messageId, list);
    anchored.add(ticket.id);
  }

  return {
    entries: messages.map((message) => ({ message, dispatches: byMessage.get(message.id) ?? [] })),
    unattributed: workers.filter((w) => !FINISHED.includes(w.status) && !(w.ticketId && anchored.has(w.ticketId))),
  };
}
