import { describe, expect, it } from 'vitest';
import { estimateTokens, getTokenizer, sliceToTokens } from './tokens.js';

/**
 * Pinned counts were captured from `o200k_base` (the encoding `tokens.ts` uses) on 2026-09-17.
 * They are the values the encoder produces for these exact strings, not a re-derivation.
 */
const CODE_FENCE = '```ts\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```\n';
const MARKDOWN_TABLE = '| Scope | Budget |\n|---|---|\n| shared | 2000 |\n| project | 10000 |\n';
const NON_ASCII = '知识库：token 预算 — naïve café résumé · 日本語のテキスト · Ελληνικά\n';

/** The heuristic this replaced, kept here only so the tests can prove the counts are not it. */
function byteRatio(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5);
}

describe('estimateTokens', () => {
  it('counts a code fence with the tokenizer, not the byte ratio', () => {
    expect(estimateTokens(CODE_FENCE)).toBe(24);
    expect(byteRatio(CODE_FENCE)).not.toBe(24);
  });

  it('counts a markdown table with the tokenizer, not the byte ratio', () => {
    expect(estimateTokens(MARKDOWN_TABLE)).toBe(24);
    expect(byteRatio(MARKDOWN_TABLE)).not.toBe(24);
  });

  it('counts non-ASCII text with the tokenizer, not the byte ratio', () => {
    expect(estimateTokens(NON_ASCII)).toBe(22);
    expect(byteRatio(NON_ASCII)).not.toBe(22);
  });

  it('reuses one lazily-created encoder', () => {
    expect(getTokenizer()).toBe(getTokenizer());
  });
});

describe('sliceToTokens', () => {
  it('returns text under the budget unchanged', () => {
    expect(sliceToTokens(CODE_FENCE, 1000)).toBe(CODE_FENCE);
  });

  it('cuts text to at most the budget at the tokenizer', () => {
    const long = `${CODE_FENCE}${NON_ASCII.repeat(20)}`;
    const cut = sliceToTokens(long, 30);
    expect(cut.length).toBeLessThan(long.length);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(30);
    expect(cut).not.toContain('\uFFFD');
  });
});
