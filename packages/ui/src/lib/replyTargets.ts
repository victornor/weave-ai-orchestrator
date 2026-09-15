/**
 * Who answered whom, from the loaded conversation (VS-447).
 *
 * The daemon stores a reply link on some weaver messages (`reply_to_message_id`, defaulted by
 * `weave_human_send` to the human message that woke the turn), but not on most of them — over a
 * recent week only 246 of 2,132 weaver messages carried one, leaving about 40% of the human's
 * messages with nothing to jump to. This computes the link the conversation actually shows:
 *
 *   1. an outbound message answers every inbound message named by its `reply_to_message_ids` (VS-449;
 *      the same-thread inbound ids), when those are loaded;
 *   2. every inbound message with no such link is answered by the first outbound message after it,
 *      before the human's next inbound message.
 *
 * A link at an outbound message, at a message from another thread, or at one the loaded window no
 * longer holds is ignored — the fallback takes over for the human side. Pure, so the fallback rule
 * is tested on its own rather than through a render.
 */
import type { ThreadMessage } from '@weave-ai/shared';

/** The response links the conversation shows, keyed by message id. */
export interface ReplyTargets {
  /** Inbound message id -> the outbound messages that answer it, oldest first. */
  responses: Map<string, string[]>;
  /** Outbound message id -> the inbound message it answers, when that is a loaded inbound message. */
  repliesTo: Map<string, string>;
}

export function replyTargets(messages: readonly ThreadMessage[]): ReplyTargets {
  const responses = new Map<string, string[]>();
  const repliesTo = new Map<string, string>();
  const byId = new Map(messages.map((m) => [m.id, m] as const));

  // (a) The stored links, where they name loaded inbound messages in this thread. A batched turn
  // links one reply to every human message it answered (VS-449's `replyToMessageIds`), so each of
  // those human messages jumps to the same reply.
  for (const m of messages) {
    if (m.direction !== 'outbound') continue;
    const targets = new Set<string>(m.replyToMessageIds);
    if (m.replyToMessageId) targets.add(m.replyToMessageId);
    for (const id of targets) {
      const target = byId.get(id);
      if (!target || target.direction !== 'inbound' || target.threadId !== m.threadId) continue;
      const linked = responses.get(target.id);
      if (linked) linked.push(m.id);
      else responses.set(target.id, [m.id]);
    }
    // The quote answers one message: `replyToMessageId` stays the newest single target (VS-449).
    const quoteTarget = m.replyToMessageId ? byId.get(m.replyToMessageId) : undefined;
    if (quoteTarget && quoteTarget.direction === 'inbound' && quoteTarget.threadId === m.threadId) {
      repliesTo.set(m.id, quoteTarget.id);
    }
  }

  // (b) The unlinked human messages: the first outbound message before the human's next message.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.direction !== 'inbound' || responses.has(m.id)) continue;
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]!;
      if (next.direction === 'inbound') break;
      if (next.direction === 'outbound' && next.threadId === m.threadId) {
        responses.set(m.id, [next.id]);
        break;
      }
    }
  }

  return { responses, repliesTo };
}