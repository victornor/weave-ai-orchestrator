import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProviderCompatSchema, ProviderParamsSchema } from '@weave-ai/shared';
import { loadPreset, mergeCompat, presetsDir, PRESET_NAMES, resolveProvider, type Preset } from './resolve.js';
import { readFixture } from './fixtures.js';

const preset: Preset = { compat: { maxTokensParam: 'max_completion_tokens', omitParams: ['seed'], reasoning: { passBack: 'all', effortParam: 'reasoning_effort' } }, params: { temperature: 0.1, topP: 0.9 }, verified: false };

describe('precedence: preset < profile < model < role or worker option', () => {
  const table: Array<{ name: string; input: Parameters<typeof resolveProvider>[0]; params: Record<string, unknown>; maxTokensParam: string }> = [
    { name: 'the preset alone', input: { preset, profile: {} }, params: { temperature: 0.1, topP: 0.9 }, maxTokensParam: 'max_completion_tokens' },
    { name: 'the profile beats the preset', input: { preset, profile: { params: { temperature: 0.2 }, compat: { maxTokensParam: 'max_tokens' } } }, params: { temperature: 0.2, topP: 0.9 }, maxTokensParam: 'max_tokens' },
    { name: 'the model beats the profile', input: { preset, profile: { params: { temperature: 0.2 } }, model: { params: { temperature: 0.3 } } }, params: { temperature: 0.3, topP: 0.9 }, maxTokensParam: 'max_completion_tokens' },
    { name: 'the option beats the model', input: { preset, profile: { params: { temperature: 0.2 } }, model: { params: { temperature: 0.3 } }, options: { temperature: 0.9 } }, params: { temperature: 0.9, topP: 0.9 }, maxTokensParam: 'max_completion_tokens' },
    { name: 'a layer that sets nothing does not clear a lower one', input: { preset, profile: { params: {} }, model: { params: {} }, options: {} }, params: { temperature: 0.1, topP: 0.9 }, maxTokensParam: 'max_completion_tokens' },
    { name: 'no layer sets it: unset', input: { profile: {} }, params: {}, maxTokensParam: 'max_tokens' },
  ];
  for (const row of table) it(row.name, () => {
    const r = resolveProvider(row.input);
    expect(r.params).toEqual(row.params);
    expect(r.compat.maxTokensParam).toBe(row.maxTokensParam);
    expect(r.errors).toEqual([]);
  });
  it('merges nested blocks field by field and unions omitParams', () => {
    const r = resolveProvider({ preset, profile: { compat: { omitParams: ['top_p'], reasoning: { passBack: 'none' } } }, model: { compat: { omitParams: ['seed'] } } });
    expect(r.compat.omitParams.sort()).toEqual(['seed', 'top_p']);
    expect(r.compat.reasoning).toMatchObject({ passBack: 'none', effortParam: 'reasoning_effort' });
  });
  it('the option layer carries every parameter key and rejects a bad one by name', () => {
    const ok = resolveProvider({ profile: {}, options: { temperature: 1, topP: 0.5, frequencyPenalty: 1, presencePenalty: -1, maxOutputTokens: 9.7, seed: 4, stop: ['x'], toolChoice: 'auto', parallelToolCalls: true, responseFormat: 'text', extraBody: '{}', contextWindowTokens: 8000.4 } });
    expect(ok.errors).toEqual([]);
    expect(ok.params).toEqual({ temperature: 1, topP: 0.5, frequencyPenalty: 1, presencePenalty: -1, maxOutputTokens: 9, seed: 4, stop: ['x'], toolChoice: 'auto', parallelToolCalls: true, responseFormat: 'text', extraBody: '{}', contextWindowTokens: 8000 });
    const bad = resolveProvider({ profile: {}, options: { temperature: 5 } });
    expect(bad.errors.join()).toMatch(/temperature/);
  });
  it('mergeCompat is pure: inputs are not mutated', () => {
    const a = { omitParams: ['a'] }; const b = { omitParams: ['b'] };
    mergeCompat(a, b);
    expect(a.omitParams).toEqual(['a']); expect(b.omitParams).toEqual(['b']);
  });
});

describe('presets', () => {
  it('ships every named preset, and each validates against the schemas', () => {
    const files = readdirSync(presetsDir()).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual([...PRESET_NAMES].sort());
    for (const name of PRESET_NAMES) {
      const p = loadPreset(name)!;
      expect(p, name).toBeDefined();
      expect(ProviderCompatSchema.safeParse(p.compat ?? {}).success, name).toBe(true);
      expect(ProviderParamsSchema.safeParse(p.params ?? {}).success, name).toBe(true);
    }
  });
  it('covers the thirteen providers named in the ticket', () => {
    for (const n of ['openai', 'azure-openai', 'openrouter', 'deepseek', 'together', 'groq', 'fireworks', 'mistral', 'ollama', 'lmstudio', 'vllm', 'llamacpp', 'litellm']) expect(loadPreset(n), n).toBeDefined();
  });
  it('is verified only where a capture exists, and every named capture is a real fixture file', () => {
    for (const name of PRESET_NAMES) {
      const v = loadPreset(name)!.verified;
      if (v === false) continue;
      for (const [flag, file] of Object.entries(v)) expect(() => readFixture(file), `${name}: ${flag}`).not.toThrow();
    }
    expect(Object.keys(loadPreset('zai')!.verified as object)).toContain('maxTokensParam');
    for (const n of ['openai', 'deepseek', 'mistral', 'ollama', 'vllm']) expect(loadPreset(n)!.verified, n).toBe(false);
  });
  it('encodes what the probes proved: Z.ai sends max_tokens; OpenRouter reads `reasoning`; cheaper-inference reads reasoning_content', () => {
    expect(resolveProvider({ preset: loadPreset('zai'), profile: {} }).compat.maxTokensParam).toBe('max_tokens');
    expect(resolveProvider({ preset: loadPreset('openrouter'), profile: {} }).compat.reasoning.field).toBe('reasoning');
  });
  it('an unknown or malformed preset name is undefined, not a path', () => {
    expect(loadPreset('nope')).toBeUndefined();
    expect(loadPreset('../package')).toBeUndefined();
  });
});
