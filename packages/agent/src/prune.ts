import { messageTokens, textTokens } from './tokens.js';
import type { Message } from './types.js';

/** Pruning starts above this share of the window. Below it the request prefix is left byte-stable so provider prefix caching keeps working. */
export const PRUNE_ABOVE = 0.7;
/** The newest tool output kept whole. */
export const PRUNE_PROTECT_TOKENS = 40_000;
/** Pruning must save at least this much, or it is not worth breaking the cached prefix. */
export const PRUNE_MIN_SAVING_TOKENS = 20_000;

export const prunedStub = (chars: number): string => `[output pruned; ${chars} chars, re-run if needed]`;

type ToolResult = Extract<Message, { role: 'toolResult' }>;

/**
 * The messages as one request should carry them. When the request would take more than 70 % of the window,
 * tool results older than the newest 40k tokens of tool output become a stub, provided that saves at least
 * 20k tokens. Errors and the newest result of each tool are never pruned. The session is not touched: this is
 * a projection, and messages it does not change are returned as the same objects.
 */
export function pruneMessages(messages: Message[], input: { estimate: number; window: number | undefined }): Message[] {
  if (!input.window || input.estimate <= input.window * PRUNE_ABOVE) return messages;
  const newestOfTool = new Set<number>();
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'toolResult' && !seen.has(m.name)) { seen.add(m.name); newestOfTool.add(i); }
  }
  let protectedTokens = 0;
  let saving = 0;
  const toPrune: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'toolResult') continue;
    const tokens = messageTokens(m);
    if (protectedTokens < PRUNE_PROTECT_TOKENS || newestOfTool.has(i) || m.isError || isPruned(m)) { protectedTokens += tokens; continue; }
    const gain = tokens - textTokens(prunedStub(m.text.length)) - 4;
    if (gain <= 0) continue;
    toPrune.push(i);
    saving += gain;
  }
  if (saving < PRUNE_MIN_SAVING_TOKENS) return messages;
  const drop = new Set(toPrune);
  return messages.map((m, i) => (drop.has(i) ? { ...(m as ToolResult), text: prunedStub((m as ToolResult).text.length) } : m));
}

const isPruned = (m: ToolResult): boolean => m.text.startsWith('[output pruned;');
