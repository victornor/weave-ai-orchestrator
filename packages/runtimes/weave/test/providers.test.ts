import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AC_ENV, ProviderProfileSchema, WorkspaceConfigSchema, validateRuntimeOptions, type ProviderProfile } from '@weave-ai/shared';
import type { RuntimeEvent, TurnHandle, TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import { createAdapter } from '../src/index.js';
import { PRESET_NAMES, loadPreset } from '../src/index.js';
import { Semaphore } from '../src/semaphore.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-agent.mjs');
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-prov-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = (over: Partial<ProviderProfile>): ProviderProfile => ({ baseUrl: 'https://llm.example.test/v1', auth: 'bearer', headers: {}, models: {}, ...over });
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('preset catalogue', () => {
  it('is served through the runtime package, with a description per preset', () => {
    expect(PRESET_NAMES).toContain('openai');
    expect(PRESET_NAMES).toContain('openai-compatible');
    const openai = loadPreset('openai');
    expect(openai?.description).toBeTruthy();
    expect(openai?.compat?.maxTokensParam).toBe('max_completion_tokens');
    expect(loadPreset('not-a-preset')).toBeUndefined();
  });
});

describe('provider administration surfaces', () => {
  it('declares every sampling parameter in its configSchema and validates their ranges', () => {
    const schema = createAdapter({ entry: FAKE }).configSchema();
    const props = (schema as { properties: Record<string, unknown> }).properties;
    for (const key of ['maxOutputTokens', 'temperature', 'topP', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop', 'toolChoice', 'parallelToolCalls', 'responseFormat', 'extraBody', 'extraHeaders']) {
      expect(props, key).toHaveProperty(key);
    }
    expect(validateRuntimeOptions(schema, { temperature: 3 })).toMatchObject({ valid: false, byKey: { temperature: 'must be at most 2' } });
    expect(validateRuntimeOptions(schema, { topP: -1 })).toMatchObject({ valid: false, byKey: { topP: 'must be at least 0' } });
    expect(validateRuntimeOptions(schema, { nope: 1 })).toMatchObject({ valid: false, byKey: { nope: 'not an option this runtime understands' } });
  });
});

describe('model discovery', () => {
  it('merges configured and discovered models, takes windows from contextField, and lists efforts from the preset', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') }); return json(200, { data: [{ id: 'a', context_length: 65536 }, { id: 'b' }] }); }) as typeof fetch;
    const providers = { or: base({ preset: 'openrouter', apiKeySecret: 'WEAVE_LLM_OR_KEY', models: { b: { contextWindow: 1000 }, own: {} } }) };
    const a = createAdapter({ entry: FAKE, host: { providers: () => providers, providerKey: (id) => (id === 'or' ? 'sk-disco' : undefined) }, fetch: fetchFn });
    const models = await a.listModels();
    expect(models.map((m) => [m.id, m.source, m.contextWindowTokens])).toEqual([['or/b', 'static', 1000], ['or/own', 'static', undefined], ['or/a', 'detected', 65536]]);
    expect(seen).toEqual([{ url: 'https://llm.example.test/v1/models', auth: 'Bearer sk-disco' }]);
    expect(await a.modelContextWindow!('or/a')).toBe(65536);
    expect(await a.modelContextWindow!('or/b')).toBe(1000);
  });
  it('survives a 500 and a thrown fetch: the static models still list', async () => {
    for (const fetchFn of [(async () => json(500, { error: 'down' })) as typeof fetch, (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch]) {
      const a = createAdapter({ entry: FAKE, host: { providers: () => ({ p: base({ models: { m: { contextWindow: 9 } } }) }) }, fetch: fetchFn });
      expect((await a.listModels()).map((m) => m.id)).toEqual(['p/m']);
    }
  });
  it('caches for ten minutes, retries a failure after one, and honours discover:false', async () => {
    let now = 1_000_000; let calls = 0; let ok = false;
    const fetchFn = (async () => { calls++; return ok ? json(200, { data: [{ id: 'x' }] }) : json(500, {}); }) as typeof fetch;
    const a = createAdapter({ entry: FAKE, host: { providers: () => ({ p: base({}), q: base({ discover: false }) }) }, fetch: fetchFn, now: () => now });
    await a.listModels(); expect(calls).toBe(1);
    now += 30_000; await a.listModels(); expect(calls).toBe(1);
    now += 40_000; ok = true; expect((await a.listModels()).map((m) => m.id)).toEqual(['p/x']); expect(calls).toBe(2);
    now += 9 * 60_000; await a.listModels(); expect(calls).toBe(2);
    now += 2 * 60_000; await a.listModels(); expect(calls).toBe(3);
  });
});

function input(cwd: string, prompt: string, over: Partial<TurnInput> = {}): TurnInput {
  return {
    runId: `run-${prompt}`, turnEpoch: 1, cwd, worktree: { path: join(cwd, 'wt'), branch: 'ac/x' },
    session: { policy: 'resume', ref: null, isFirstTurn: true }, systemPrompt: { text: '', mode: 'skip' }, prompt, mcpServers: {},
    env: { [AC_ENV.RUN_TOKEN]: 't', WEAVE_LLM_Z_KEY: 'sk-yaml' }, options: {}, limits: { timeoutMs: 60_000 }, permission: { mode: 'auto' }, model: 'z/glm-4.5-air', configHome: join(cwd, 'cfg'), ...over,
  };
}
const sink = (): TurnSink => ({ onSpawn: () => undefined, onEvent: (_e: RuntimeEvent) => undefined, onRaw: () => undefined });
const record = (cwd: string): { init: Record<string, any> } => JSON.parse(readFileSync(join(cwd, 'record.json'), 'utf8'));

const YAML = `
providers:
  z:
    preset: zai
    baseUrl: https://api.z.ai/api/coding/paas/v4
    apiKeySecret: WEAVE_LLM_Z_KEY
    headers: { X-Team: platform }
    query: { api-version: "1" }
    params: { temperature: 0.2, extraHeaders: ["X-Extra: yes"] }
    compat: { omitParams: [presence_penalty] }
    models:
      glm-4.5-air:
        contextWindow: 128000
        params: { temperature: 0.5, topP: 0.9 }
`;

describe('adding a provider is data', () => {
  it('a profile parsed from YAML resolves by precedence into what the child receives, with no code for the provider', async () => {
    const profile = ProviderProfileSchema.parse((parseYaml(YAML) as { providers: Record<string, unknown> }).providers['z']);
    const a = createAdapter({ entry: FAKE, host: { providers: () => ({ z: profile }) } });
    mkdirSync(join(dir, 'wt'));
    const r = await a.runTurn(input(dir, 'noise', { options: { topP: 0.3, maxOutputTokens: 200 } }), sink());
    expect(r.exitCode).toBe(0);
    const init = record(dir).init;
    expect(init['provider']).toMatchObject({ id: 'z', baseUrl: 'https://api.z.ai/api/coding/paas/v4', query: { 'api-version': '1' }, headers: { 'X-Team': 'platform', 'X-Extra': 'yes' } });
    // preset (zai) < profile < model < option
    expect(init['provider'].compat).toMatchObject({ maxTokensParam: 'max_tokens', omitParams: ['presence_penalty'], reasoning: { field: 'reasoning_content' } });
    expect(init['provider'].params).toMatchObject({ temperature: 0.5, topP: 0.3, maxOutputTokens: 200 });
    expect(init['run'].options).toEqual({ topP: 0.3, maxOutputTokens: 200 });
  });
  it('the same profile inside a whole workspace config validates', () => {
    const cfg = WorkspaceConfigSchema.parse({ ...(parseYaml('version: 1\nid: ws\nname: WS\nticketPrefix: WS\n') as object), ...(parseYaml(YAML) as object) });
    expect(cfg.providers['z']!.models['glm-4.5-air']!.params).toEqual({ temperature: 0.5, topP: 0.9 });
  });
  it('refuses an unknown preset, bad options and a malformed extra header before spawning anything', async () => {
    mkdirSync(join(dir, 'wt'));
    const run = (p: ProviderProfile, options: Record<string, unknown> = {}) => createAdapter({ entry: FAKE, host: { providers: () => ({ z: p }) } }).runTurn(input(dir, 'noise', { options }), sink());
    expect((await run(base({ preset: 'nope', apiKeySecret: 'WEAVE_LLM_Z_KEY' }))).error).toMatchObject({ code: 'preset_unknown', family: 'tooling' });
    expect((await run(base({ apiKeySecret: 'WEAVE_LLM_Z_KEY' }), { temperature: 9 })).error).toMatchObject({ code: 'invalid_option' });
    expect((await run(base({ apiKeySecret: 'WEAVE_LLM_Z_KEY', params: { extraHeaders: ['nocolon'] } }))).error?.message).toContain('nocolon');
    expect(existsSync(join(dir, 'record.json'))).toBe(false);
  });
});

describe('maxConcurrentRuns', () => {
  it('holds a second run until the first ends, and a run cancelled while waiting never spawns', async () => {
    const profile = base({ apiKeySecret: 'WEAVE_LLM_Z_KEY', maxConcurrentRuns: 1, discover: false });
    const a = createAdapter({ entry: FAKE, host: { providers: () => ({ z: profile }) } });
    const cwd = (n: string): string => { const d = join(dir, n); mkdirSync(join(d, 'wt'), { recursive: true }); return d; };
    const [d1, d2, d3] = [cwd('one'), cwd('two'), cwd('three')];
    let h1: TurnHandle | undefined; let h2: TurnHandle | undefined;
    const p1 = a.runTurn(input(d1, 'hang'), sink(), (h) => { h1 = h; });
    while (!existsSync(join(d1, 'record.json'))) await new Promise((r) => setTimeout(r, 10));
    const p2 = a.runTurn(input(d2, 'hang'), sink(), (h) => { h2 = h; });
    const p3 = a.runTurn(input(d3, 'noise'), sink());
    await new Promise((r) => setTimeout(r, 150));
    expect(existsSync(join(d2, 'record.json'))).toBe(false);
    expect(existsSync(join(d3, 'record.json'))).toBe(false);
    expect(h2!.pid).toBeNull();
    await h2!.cancel('interrupt');
    expect(await p2).toMatchObject({ exitCode: 143, signal: 'SIGTERM' });
    expect(existsSync(join(d2, 'record.json'))).toBe(false);
    expect(h1!.pid).not.toBeNull();
    await h1!.cancel('interrupt');
    expect(await p1).toMatchObject({ exitCode: 143 });
    expect((await p3).exitCode).toBe(0);
    expect(existsSync(join(d3, 'record.json'))).toBe(true);
  });
  it('the semaphore grants in order, releases once, and drops an aborted waiter', async () => {
    const s = new Semaphore(1);
    const r1 = await s.acquire();
    const ac = new AbortController();
    const w2 = s.acquire(ac.signal); const w3 = s.acquire();
    expect(s.waiting).toBe(2);
    ac.abort();
    await expect(w2).rejects.toThrow('aborted');
    r1(); r1();
    expect(s.active).toBe(1);
    (await w3)();
    expect(s.active).toBe(0); expect(s.waiting).toBe(0);
  });
});
