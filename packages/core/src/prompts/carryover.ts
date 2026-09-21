/**
 * VS-656: the compact account of an earlier conversation handed to a new session after an
 * involuntary retirement.
 *
 * A session retired because its tool contract changed (VS-542) cannot be resumed, and one retired as
 * idle is retired by policy; in both cases the next turn's runtime starts empty. This builds the
 * account from what is already stored — the session's own thread messages, in order — so the new
 * runtime begins with the conversation's substance rather than nothing. It is deterministic, does no
 * inference and reads no other thread.
 *
 * The bound is deliberate: newest messages are kept until the budget is spent, so the most recent
 * conversation survives intact and the model is told (by the omission line) that the account is
 * partial. Nothing here is written back to the thread.
 */
import type { ThreadMessage } from '@weave-ai/shared';

export interface CarryOverOptions {
  /** How the session's own messages are labelled in the account (its role or agent name). */
  agentLabel?: string;
  /** Message ids to leave out — the turn's own waking messages, rendered separately in the prompt. */
  excludeIds?: readonly string[];
  /** At most this many messages. Default 40. */
  maxMessages?: number;
  /** At most this many characters in total. Default 12_000 (~3_000 tokens). */
  maxChars?: number;
  /** At most this many characters per message. Default 1_500. */
  perMessageChars?: number;
}

const DEFAULTS = { maxMessages: 40, maxChars: 12_000, perMessageChars: 1_500 } as const;

function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, Math.max(0, cap - 1))}…`;
}

/** One account line: who spoke and what they said, collapsed to a single line and capped. */
function line(message: ThreadMessage, cap: number, agentLabel: string): string {
  const who = message.authorKind === 'human' ? 'you' : message.authorKind === 'system' ? 'system' : agentLabel;
  const body = truncate(message.body.replace(/\s+/g, ' ').trim(), cap);
  return `- ${who}: ${body}`;
}

/**
 * The conversation's compact account, oldest-first, or `''` when there is nothing to carry.
 */
export function sessionCarryOverDigest(messages: readonly ThreadMessage[], opts: CarryOverOptions = {}): string {
  const maxMessages = opts.maxMessages ?? DEFAULTS.maxMessages;
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const perMessage = opts.perMessageChars ?? DEFAULTS.perMessageChars;
  const agentLabel = opts.agentLabel ?? 'assistant';
  const exclude = new Set(opts.excludeIds ?? []);
  const usable = messages.filter((m) => !exclude.has(m.id));
  if (!usable.length) return '';

  // Newest-first selection, so the most recent conversation is what survives the budget.
  const picked: string[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0 && picked.length < maxMessages; i -= 1) {
    const rendered = line(usable[i]!, perMessage, agentLabel);
    if (picked.length > 0 && used + rendered.length > maxChars) break;
    picked.push(rendered);
    used += rendered.length + 1;
  }
  picked.reverse();
  const omitted = usable.length - picked.length;
  const head = omitted > 0 ? [`(${omitted} earlier message${omitted === 1 ? '' : 's'} omitted)`] : [];
  return [...head, ...picked].join('\n');
}
