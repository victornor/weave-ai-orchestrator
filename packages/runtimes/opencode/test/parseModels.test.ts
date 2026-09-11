import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseModels } from '../src/adapter.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('parseModels — captured `opencode models --verbose` (2026-09-11, 1.18.30)', () => {
  it('reads variant keys from the full dump and `[]` when variants is empty', () => {
    const models = parseModels(fixture('models-verbose.txt'));
    expect(models.length).toBeGreaterThan(1);
    const empty = models.find((m) => m.id === 'opencode/big-pickle');
    expect(empty?.efforts).toEqual([]);
    const keyed = models.find((m) => m.id === 'opencode/ling-3.0-flash-fin-free');
    expect(keyed?.efforts).toEqual(['low', 'medium', 'high']);
    expect(models.every((m) => m.source === 'detected' && m.id.includes('/'))).toBe(true);
  });

  it('parses the excerpt of that dump the same way', () => {
    const models = parseModels(fixture('models-verbose-excerpt.txt'));
    expect(models.map((m) => [m.id, m.efforts])).toEqual([
      ['opencode/big-pickle', []],
      ['opencode/ling-3.0-flash-fin-free', ['low', 'medium', 'high']],
    ]);
  });

  it('omits a disabled variant (surgical `disabled: true` on otherwise-real ling JSON; live dump had none)', () => {
    const models = parseModels(fixture('models-verbose-disabled.txt'));
    expect(models.find((m) => m.id === 'opencode/ling-3.0-flash-fin-free')?.efforts).toEqual(['medium', 'high']);
  });

  it('omits efforts on a non-verbose id-only listing', () => {
    const models = parseModels('anthropic/claude-sonnet-5\nopenai/gpt-5.1\n');
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-5.1']);
    expect(models.every((m) => m.efforts === undefined)).toBe(true);
  });
});
