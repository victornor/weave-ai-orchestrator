import { describe, expect, it } from 'vitest';
import { PRUNE_MIN_SAVING_TOKENS, pruneMessages, prunedStub } from './prune.js';
import { messagesTokens } from './tokens.js';
import type { Message } from './types.js';

/** `n` read calls whose results are each about 3000 tokens (varied words: a repeated one would be sampled, not counted). */
function history(n: number, resultChars = 12000): Message[] {
  const out: Message[] = [{ role: 'user', text: 'go' }];
  for (let i = 0; i < n; i++) {
    out.push({ role: 'assistant', content: [{ type: 'toolCall', id: `c${i}`, name: i % 2 ? 'read' : 'bash', args: {} }] });
    out.push({ role: 'toolResult', toolCallId: `c${i}`, name: i % 2 ? 'read' : 'bash', text: `${i} ` + Array.from({ length: resultChars / 6 }, (_, k) => `w${(k * 7 + i) % 900}`).join(' ').slice(0, resultChars), isError: false });
  }
  return out;
}
const results = (ms: Message[]) => ms.filter((m) => m.role === 'toolResult') as Array<Extract<Message, { role: 'toolResult' }>>;

describe('pruneMessages', () => {
  it('returns the very same list below 70 % of the window, so the prefix stays byte-stable', () => {
    const h = history(40);
    expect(pruneMessages(h, { estimate: 69_000, window: 100_000 })).toBe(h);
    expect(pruneMessages(h, { estimate: 900_000, window: undefined })).toBe(h);
  });
  it('stubs old tool results above 70 %, keeping the newest 40k tokens and the newest result of each tool', () => {
    const h = history(40);
    expect(messagesTokens(h)).toBeGreaterThan(80_000);
    const p = pruneMessages(h, { estimate: 80_000, window: 100_000 });
    const r = results(p);
    expect(r.some((x) => x.text.startsWith('[output pruned;'))).toBe(true);
    expect(r.at(-1)!.text.startsWith('[output pruned;')).toBe(false);
    expect(r.at(-2)!.text.startsWith('[output pruned;')).toBe(false);
    expect(r[0]!.text).toBe(prunedStub(h.filter((m) => m.role === 'toolResult')[0]!.role === 'toolResult' ? (h[2] as { text: string }).text.length : 0));
    expect(messagesTokens(p)).toBeLessThan(messagesTokens(h) - PRUNE_MIN_SAVING_TOKENS);
    // the session's own messages are not mutated
    expect(results(h).every((x) => !x.text.startsWith('[output pruned;'))).toBe(true);
    // the newest 40k tokens are whole
    let tail = 0; let i = p.length - 1;
    while (i >= 0 && tail < 39_000) { if (p[i]!.role === 'toolResult') tail += messagesTokens([p[i]!]); i--; }
    expect(results(p.slice(i + 1)).every((x) => !x.text.startsWith('[output pruned;'))).toBe(true);
  });
  it('does nothing when the saving would be under 20k tokens', () => {
    const h = history(10);
    expect(pruneMessages(h, { estimate: 80_000, window: 100_000 })).toBe(h);
  });
  it('never prunes an error result', () => {
    const h = history(40);
    const e = h[2] as Extract<Message, { role: 'toolResult' }>;
    h[2] = { ...e, isError: true };
    const p = pruneMessages(h, { estimate: 80_000, window: 100_000 });
    expect((p[2] as { text: string }).text).toBe(e.text);
  });
  it('is stable: pruning the pruned list changes nothing further, and untouched messages keep their identity', () => {
    const h = history(40);
    const p = pruneMessages(h, { estimate: 80_000, window: 100_000 });
    expect(p[0]).toBe(h[0]);
    const q = pruneMessages(p, { estimate: 80_000, window: 100_000 });
    expect(q.map((m) => JSON.stringify(m))).toEqual(p.map((m) => JSON.stringify(m)));
  });
});
