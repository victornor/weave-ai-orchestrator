import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ToolSpec } from './codec/chatCompletions.js';
import type { Message } from './types.js';

/**
 * The same encoding `@weave-ai/shared` counts knowledge budgets with, loaded here directly: the child runs from
 * source in tests, where `shared` is not built, so its run path must not import it.
 */
let encoder: Tiktoken | null = null;
export function estimateTokens(text: string): number { return (encoder ??= getEncoding('o200k_base')).encode(text).length; }
/** `text` cut to at most `budget` tokens. */
export function sliceToTokens(text: string, budget: number): string {
  const enc = (encoder ??= getEncoding('o200k_base'));
  const tokens = enc.encode(text);
  return tokens.length <= budget ? text : enc.decode(tokens.slice(0, budget)).replace(/\uFFFD+$/, '');
}

/** Other tokenizers differ from o200k_base by up to ±20 %; the margin keeps an under-count from becoming an overflow. */
export const TOKEN_MARGIN = 1.15;
/** Per-message framing the wire adds (role, separators) that the text alone does not carry. */
const MESSAGE_OVERHEAD = 4;
/** An image's cost varies by provider and size; a flat figure keeps the estimate on the safe side of a typical screenshot. */
const IMAGE_TOKENS = 1600;

const cache = new WeakMap<object, number>();
/** BPE is quadratic on long runs of one character, so a long text is measured on a head and tail sample and scaled. */
const SAMPLE_OVER = 8_000;
const SAMPLE = 2_000;
export function textTokens(s: string): number {
  if (s.length <= SAMPLE_OVER) return estimateTokens(s);
  return Math.ceil(((estimateTokens(s.slice(0, SAMPLE)) + estimateTokens(s.slice(-SAMPLE))) / (2 * SAMPLE)) * s.length);
}

/** Tokens of one message under the shared encoding, without the margin. Memoised: a 500-message history is encoded once. */
export function messageTokens(m: Message): number {
  const hit = cache.get(m);
  if (hit !== undefined) return hit;
  let text: string;
  if (m.role === 'user') text = m.text;
  else if (m.role === 'toolResult') text = m.text;
  else text = m.content.map((b) => (b.type === 'toolCall' ? `${b.name}${b.raw ?? JSON.stringify(b.args)}` : b.type === 'image' ? '' : b.text)).join('\n');
  const images = m.role === 'assistant' ? m.content.filter((b) => b.type === 'image').length : (m.images?.length ?? 0);
  const n = textTokens(text) + MESSAGE_OVERHEAD + images * IMAGE_TOKENS;
  cache.set(m, n);
  return n;
}

export function messagesTokens(ms: readonly Message[]): number { let n = 0; for (const m of ms) n += messageTokens(m); return n; }

/** The tool definitions as the request carries them: the weaver's ~40 schemas are several thousand tokens on every request. */
export function toolsTokens(tools: readonly ToolSpec[]): number { return tools.length === 0 ? 0 : textTokens(JSON.stringify(tools)); }

/**
 * Estimates the size of the next request. Before any response it is everything counted here, with
 * the margin. After one, the provider's own `prompt_tokens` is the base and only the messages added
 * since are estimated. A compaction changes the prefix, so it drops the anchor.
 */
export class RequestSizer {
  private anchor: { promptTokens: number; count: number } | null = null;

  /** `count` is how many projected messages that request carried. */
  observe(promptTokens: number, count: number): void { this.anchor = promptTokens > 0 ? { promptTokens, count } : null; }
  reset(): void { this.anchor = null; }

  estimate(input: { system: string; tools: readonly ToolSpec[]; messages: readonly Message[] }): number {
    if (this.anchor && input.messages.length >= this.anchor.count) {
      return Math.ceil(this.anchor.promptTokens + messagesTokens(input.messages.slice(this.anchor.count)) * TOKEN_MARGIN);
    }
    return Math.ceil((textTokens(input.system) + toolsTokens(input.tools) + messagesTokens(input.messages)) * TOKEN_MARGIN);
  }
}
