import { describe, expect, it } from 'vitest';
import { adapter, composeModelId, MODELS, variantIds } from '../src/index.js';

/** `agy models` on 1.5.14, as captured in the VS-995 ticket: 23 ids. */
const AGY_MODELS_1_5_14 = [
  'gemini-4-neon-low', 'gemini-4-neon-medium', 'gemini-4-neon-high', 'gemini-4-neon-xhigh',
  'gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high',
  'gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh',
  'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high',
  'gemini-pro-orchestrator-neon', 'gemini-pro-orchestrator-g1-pro',
  'claude-opus-5-5-low', 'claude-opus-5-5-medium', 'claude-opus-5-5-high',
  'claude-sonnet-5-5-low', 'claude-sonnet-5-5-medium', 'claude-sonnet-5-5-high',
  'gpt-oss-120b-medium',
];

describe('agy models (VS-995)', () => {
  it('lists every id agy 1.5.14 offers, Claude and GPT-OSS included', () => {
    expect(variantIds().sort()).toEqual([...AGY_MODELS_1_5_14].sort());
    expect(variantIds()).toHaveLength(23);
  });

  it('names the families the way captain does, and marks agy-routed Claude apart from the claude runtime', async () => {
    const labels = (await adapter.listModels()).map((m) => m.label);
    for (const l of ['Gemini 4 Neon', 'Gemini 4 Argon', 'Gemini 4 Hydrogen', 'Orchestrator (Neon)', 'Orchestrator (Argon)', 'Gemini 3.8 Flash', 'GPT-OSS 120B']) expect(labels).toContain(l);
    expect(labels).toContain('Claude Opus 5.5 (Antigravity)');
    expect(labels).toContain('Claude Sonnet 5.5 (Antigravity)');
    expect(new Set(MODELS.map((m) => m.provider))).toEqual(new Set(['antigravity']));
  });

  it.each([
    ['gemini-4-neon', 'high', 'gemini-4-neon-high'],
    ['claude-opus-5-5', 'high', 'claude-opus-5-5-high'],
    ['claude-sonnet-5-5', 'low', 'claude-sonnet-5-5-low'],
    ['gemini-4-argon', 'xhigh', 'gemini-4-argon-high'],
    ['gemini-4-argon', 'max', 'gemini-4-argon-high'],
    ['gpt-oss-120b', 'low', 'gpt-oss-120b-medium'],
    ['gpt-oss-120b', 'high', 'gpt-oss-120b-medium'],
    ['gemini-4-hydrogen', null, 'gemini-4-hydrogen-medium'],
    ['gemini-4-neon-high', 'low', 'gemini-4-neon-high'],
    ['gemini-pro-orchestrator-neon', 'high', 'gemini-pro-orchestrator-neon'],
    ['some-future-model', 'high', 'some-future-model'],
  ])('composes %s + %s as %s', (model, effort, expected) => {
    expect(composeModelId(model, effort)).toBe(expected);
  });

  it('every composed family id is one agy lists', () => {
    const ids = new Set(variantIds());
    for (const m of MODELS) for (const e of [null, ...(m.efforts ?? []), 'max', 'low']) expect(ids.has(composeModelId(m.id, e))).toBe(true);
  });
});
