/**
 * The persistent session's conversation, as the raw session (VS-618).
 *
 * A session's thread holds the human's messages and each turn's delivered answer; the turn's own
 * work — its assistant text, tool calls, diffs and commands — lives in that run's events. This
 * orders the two into one conversation: messages and runs by time, with the session's own delivered
 * answer dropped because its words are the run's final text and the run's transcript already shows
 * them. A system notice and another agent's message stay, so a failure reason and a weaver relay are
 * never lost.
 *
 * Pure, so the ordering is tested on its own rather than through a render.
 */
import type { Run, ThreadMessage } from '@weave-ai/shared';

export type SessionConversationRow =
  | { kind: 'message'; key: string; at: string; message: ThreadMessage }
  | { kind: 'turn'; key: string; at: string; run: Run };

export interface SessionConversation {
  rows: SessionConversationRow[];
  /** Run id -> the delivered answer's body, so a turn whose events did not carry the final text can
   * still show it once (a runtime that reported it outside the event stream). */
  answersByRun: Map<string, string>;
}

/** Whether this outbound message is the engine's delivered copy of a session turn's final text. */
function isDeliveredAnswer(message: ThreadMessage, sessionAgentId: string): boolean {
  return (
    message.direction === 'outbound' &&
    message.authorKind === 'agent' &&
    message.authorId === sessionAgentId &&
    Boolean(message.runId)
  );
}

export function sessionConversationRows(
  messages: readonly ThreadMessage[],
  runs: readonly Run[],
  sessionAgentId: string,
): SessionConversation {
  const rows: SessionConversationRow[] = [];
  const answersByRun = new Map<string, string>();
  for (const message of messages) {
    if (isDeliveredAnswer(message, sessionAgentId)) {
      if (message.runId && !answersByRun.has(message.runId)) answersByRun.set(message.runId, message.body);
      continue;
    }
    rows.push({ kind: 'message', key: `m:${message.id}`, at: message.createdAt, message });
  }
  for (const run of runs) {
    rows.push({ kind: 'turn', key: `r:${run.id}`, at: run.startedAt ?? run.createdAt, run });
  }
  rows.sort((a, b) => (a.at === b.at ? a.key.localeCompare(b.key) : a.at.localeCompare(b.at)));
  return { rows, answersByRun };
}
