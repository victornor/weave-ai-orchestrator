import { getEncoding, type Tiktoken } from 'js-tiktoken';

/**
 * Token counting for every knowledge and context budget.
 *
 * The count used to be `ceil(bytes / 3.5)`, which is not a token count: against the markdown this
 * system stores it overstates prose by ~12–32% and understates code fences and tables by ~14–24%,
 * so a file reported at 80% of budget could be over it and a write could be rejected that would
 * have fitted. Every count now comes from a real BPE tokenizer instead.
 *
 * Encoding `o200k_base`, the most recent widely-used OpenAI BPE encoding, shipped by `js-tiktoken`
 * (the maintained pure-JS port of `tiktoken`) so the count stays synchronous. Workers run on
 * several model families — Claude, Codex, OpenCode, Gemini, Cursor — and only OpenAI's encodings
 * have a public implementation, so one encoding is used for all of them *deliberately*: a budget is
 * a property of the file, not of who reads it, and counting per runtime would make one file over
 * budget for one worker and under it for another. For the families with no public tokenizer this is
 * an approximation, but a far closer one than the byte ratio it replaced.
 */

let encoder: Tiktoken | null = null;

/** The lazily-created, process-wide encoder. Exported so a test can assert the cache is real. */
export function getTokenizer(): Tiktoken {
  if (!encoder) encoder = getEncoding('o200k_base');
  return encoder;
}

/** The token count of `text` under the shared encoding above. */
export function estimateTokens(text: string): number {
  return getTokenizer().encode(text).length;
}

/**
 * `text` cut to at most `budget` tokens, for the places text is bounded rather than rejected: the
 * per-turn inline knowledge slice and the bootstrap digest's hard cap. Decoding a partial token can
 * leave a replacement character at the cut, which is stripped.
 */
export function sliceToTokens(text: string, budget: number): string {
  const enc = getTokenizer();
  const tokens = enc.encode(text);
  if (tokens.length <= budget) return text;
  return enc.decode(tokens.slice(0, Math.max(0, budget))).replace(/\uFFFD+$/, '');
}
