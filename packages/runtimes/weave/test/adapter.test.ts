import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AC_ENV, ProviderProfileSchema, RUNTIME_PARTIAL_OUTPUT, validateRuntimeOptions, type ProviderProfile } from '@weave-ai/shared';
import type { RuntimeEvent, RuntimePartial, TurnHandle, TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import { capabilities, createAdapter } from '../src/index.js';
import { parseChildLine } from '../src/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-agent.mjs');
const KEY = 'sk-adapter-secret-789';
const profile: ProviderProfile = { baseUrl: 'https://llm.example.test/v1', apiKeySecret: 'WEAVE_LLM_TEST_KEY', auth: 'bearer', headers: {}, discover: false, models: { 'big-model': { contextWindow: 128000 } } };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-adapter-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const adapterWith = (providers: Record<string, ProviderProfile> = { test: profile }) => createAdapter({ entry: FAKE, host: { providers: () => providers } });
const record = (): { pid: number; pgid: number; argv: string[]; env: Record<string, string>; init: Record<string, any> } => JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));

function input(prompt: string, over: Partial<TurnInput> = {}): TurnInput {
  return {
    runId: 'run-1', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' },
    session: { policy: 'resume', ref: null, isFirstTurn: true }, systemPrompt: { text: 'SYS', mode: 'inject' }, prompt,
    mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:1/mcp/runs/run-1', headers: { Authorization: 'Bearer run-token-xyz' } } },
    env: { [AC_ENV.RUN_TOKEN]: 'run-token-xyz', [AC_ENV.RUN_ID]: 'run-1', WEAVE_LLM_TEST_KEY: KEY, OTHER_SECRET: 'keep-me' },
    options: { temperature: 0.4 }, limits: { timeoutMs: 60_000 }, permission: { mode: 'auto' }, model: 'test/big-model', configHome: join(dir, 'cfg'), ...over,
  };
}
function sink() {
  const events: RuntimeEvent[] = []; const partials: RuntimePartial[] = []; const raw: string[] = []; const spawns: Array<{ pid: number; pgid: number | null }> = [];
  const s: TurnSink = { onSpawn: (i) => spawns.push(i), onEvent: (e) => events.push(e), onRaw: (_s, c) => raw.push(c), onPartial: (p) => partials.push(p) };
  return { s, events, partials, raw, spawns };
}
async function runFake(prompt: string, over: Partial<TurnInput> = {}, adapter = adapterWith()) {
  const k = sink();
 
  const result = await adapter.runTurn(input(prompt, over), k.s);
  return { ...k, result };
}

describe('declaration', () => {
  it('declares what S1 delivers and matches the shared partial-output table', () => {
    expect(capabilities).toMatchObject({ resumableSessions: true, streamingInput: false, mcp: true, usageReporting: 'per_turn', costReporting: false, partialOutput: 'full', structuredOutput: false });
    expect(RUNTIME_PARTIAL_OUTPUT['weave']).toBe(capabilities.partialOutput);
    expect(adapterWith().capabilities).toBe(capabilities);
  });
  it('validates every parameter key and rejects out-of-range values by name', () => {
    const schema = adapterWith().configSchema();
    const all = { temperature: 0.2, topP: 0.5, frequencyPenalty: 1, presencePenalty: -1, maxOutputTokens: 100, seed: 3, stop: ['x'], toolChoice: 'auto', parallelToolCalls: true, responseFormat: 'json_object', extraBody: '{"a":1}', extraHeaders: ['X-A: 1'], contextWindowTokens: 8000, maxTurnTokens: 50_000, debugWire: true };
    expect(validateRuntimeOptions(schema, all)).toEqual({ valid: true, byKey: {} });
    expect(validateRuntimeOptions(schema, { temperature: 3, topP: -0.1, frequencyPenalty: 2.5, presencePenalty: -3, maxOutputTokens: 0, seed: 1.5, contextWindowTokens: 0 }).byKey).toEqual({
      temperature: 'must be at most 2', topP: 'must be at least 0', frequencyPenalty: 'must be at most 2', presencePenalty: 'must be at least -2', maxOutputTokens: 'must be at least 1', seed: 'must be an integer', contextWindowTokens: 'must be at least 1',
    });
    expect(validateRuntimeOptions(schema, { toolChoice: 'sometimes', responseFormat: 'xml', stop: [1], extraHeaders: 'X: 1', parallelToolCalls: 'yes' }).byKey).toEqual({
      toolChoice: 'must be one of auto, required, none', responseFormat: 'must be one of text, json_object', stop: 'must be a list of text values', extraHeaders: 'must be a list', parallelToolCalls: 'must be true or false',
    });
    expect(validateRuntimeOptions(schema, { logitBias: 1 }).byKey).toEqual({ logitBias: 'not an option this runtime understands' });
  });
  it('detects unsupported without a provider and available with one; lists configured models with their windows', async () => {
    expect((await adapterWith({}).detect()).status).toBe('unsupported');
    expect((await adapterWith().detect()).status).toBe('available');
    const a = adapterWith();
    expect(await a.listModels()).toEqual([{ id: 'test/big-model', label: 'big-model (test)', provider: 'test', source: 'static', contextWindowTokens: 128000 }]);
    expect(await a.modelContextWindow!('test/big-model')).toBe(128000);
    expect(await a.modelContextWindow!('test/other')).toBeUndefined();
  });
  it('attach() supplies the providers when none were passed to the factory', async () => {
    const a = createAdapter({ entry: FAKE });
    expect((await a.detect()).status).toBe('unsupported');
    a.attach!({ providers: () => ({ test: profile }) });
    expect((await a.detect()).status).toBe('available');
  });
});

describe('translating the recorded child stream', () => {
  const lines = readFileSync(join(here, 'fixtures', 'tool-turn.ndjson'), 'utf8').split('\n').filter(Boolean).map(parseChildLine);
  it('maps events, partials and the single result', () => {
    expect(lines.map((l) => (l.kind === 'event' ? l.ev.type : l.kind === 'partial' ? `partial:${l.partial.kind}` : l.kind))).toEqual([
      'turn.started', 'partial:tool_input', 'usage.delta', 'tool.call', 'tool.result', 'turn.started', 'partial:text', 'assistant.text', 'usage.delta', 'turn.completed', 'result',
    ]);
    const text = lines.find((l) => l.kind === 'event' && l.ev.type === 'assistant.text');
    const partial = lines.find((l) => l.kind === 'partial' && l.partial.kind === 'text');
    expect(text && text.kind === 'event' && partial && partial.kind === 'partial' && partial.partial.partId === text.ev.payload['partId']).toBe(true);
    const tool = lines.find((l) => l.kind === 'partial' && l.partial.kind === 'tool_input');
    expect(tool && tool.kind === 'partial' && tool.partial).toMatchObject({ toolCallId: 'call_1', partId: 'call_1', text: '{"path":"a.txt"}' });
  });
  it('keeps a non-protocol line as raw output and an unknown event type as runtime.raw', () => {
    expect(parseChildLine('hello')).toEqual({ kind: 'raw', text: 'hello' });
    expect(parseChildLine('{"t":"event","ev":{"ts":"t","type":"mystery","payload":{"a":1}}}')).toMatchObject({ kind: 'event', ev: { type: 'runtime.raw', payload: { originalType: 'mystery', data: { a: 1 } } } });
  });
});

describe('a turn through a fake child', () => {
  it('replays the recorded stream: events in order with seq, partials, and the result mapped', async () => {
    const r = await runFake('replay');
    expect(r.events.map((e) => e.type)).toEqual(['session.started', 'turn.started', 'usage.delta', 'tool.call', 'tool.result', 'turn.started', 'assistant.text', 'usage.delta', 'turn.completed']);
    expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i));
    expect(r.partials.map((p) => p.kind)).toEqual(['tool_input', 'text']);
    expect(r.result).toMatchObject({ exitCode: 0, finalText: 'The file says alpha.', model: 'mock-model', provider: 'test', usage: { inputTokens: 30, outputTokens: 11, contextTokens: 10, basis: 'per_turn' } });
    expect(r.result.session).toMatchObject({ v: 1, id: 'fixture-session' });
  });

  it('reports the child\'s real pid and its own process group to onSpawn, and the handle carries the same pid', async () => {
    const k = sink();
    let handle: TurnHandle | undefined;
    const p = adapterWith().runTurn(input('replay'), k.s, (h) => { handle = h; });
    await p;
    const rec = record();
    expect(k.spawns).toEqual([{ pid: rec.pid, pgid: rec.pid }]);
    expect(rec.pgid).toBe(rec.pid);
    expect(handle!.pid).toBe(rec.pid);
    expect(handle!.send).toBeUndefined();
  });

  it('puts the key only on stdin: not in argv, not in the child env, not in the tool env, and no run token in the tool env', async () => {
    await runFake('replay');
    const rec = record();
    expect(JSON.stringify(rec.argv)).not.toContain(KEY);
    expect(JSON.stringify(rec.env)).not.toContain(KEY);
    expect(JSON.stringify(rec.env)).not.toContain('run-token-xyz');
    expect(rec.init['provider']).toMatchObject({ id: 'test', baseUrl: profile.baseUrl, auth: 'bearer', apiKey: KEY });
    expect(rec.init['toolEnv']).toMatchObject({ OTHER_SECRET: 'keep-me', TERM: 'dumb', [AC_ENV.RUN_ID]: 'run-1' });
    expect(JSON.stringify(rec.init['toolEnv'])).not.toContain(KEY);
    expect(rec.init['toolEnv']).not.toHaveProperty(AC_ENV.RUN_TOKEN);
    expect(rec.init['toolEnv']).not.toHaveProperty('WEAVE_LLM_TEST_KEY');
    expect(rec.init['mcpServers']).toEqual({ 'weave-ai': { url: 'http://127.0.0.1:1/mcp/runs/run-1', headers: { Authorization: 'Bearer run-token-xyz' } } });
  });

  it('sends the model without the provider prefix, the options, the system prompt and session/spill locations under the config home', async () => {
    await runFake('replay');
    const init = record().init;
    expect(init['run']).toMatchObject({ model: 'big-model', options: { temperature: 0.4 }, permission: { mode: 'auto' }, spillDir: join(dir, 'cfg', 'weave-agent', 'tool-output', 'run-1') });
    expect(init['systemPrompt']).toEqual({ text: 'SYS', mode: 'inject' });
    expect(init['session'].path.startsWith(join(dir, 'cfg', 'weave-agent', 'sessions'))).toBe(true);
  });

  it('resumes the stored session and says so', async () => {
    const ref = { v: 1, id: 'sess-9', path: join(dir, 'sess-9.jsonl'), leafId: 'x' };
    const r = await runFake('replay', { session: { policy: 'resume', ref, isFirstTurn: false } });
    expect(r.events[0]).toMatchObject({ type: 'session.resumed', payload: { sessionId: 'sess-9' } });
    expect(record().init['session']).toEqual({ id: 'sess-9', path: ref.path });
  });

  it('cancels through the handle: the child reports 143', async () => {
    const k = sink();
    let handle: TurnHandle | undefined;
    const p = adapterWith().runTurn(input('hang'), k.s, (h) => { handle = h; });
    while (!existsSync(join(dir, 'record.json'))) await new Promise((r) => setTimeout(r, 10));
    await handle!.cancel('interrupt');
    expect(await p).toMatchObject({ exitCode: 143, signal: 'SIGTERM' });
  });

  it('turns a child that dies without a result into an error result, and SIGKILL into a resource error', async () => {
    const crash = await runFake('crash');
    expect(crash.result).toMatchObject({ exitCode: 1, error: { code: 'agent_crashed', family: 'unknown' } });
    expect(crash.result.error!.message).toContain('boom: something broke');
    expect(crash.raw).toContain('boom: something broke');
    const killed = await runFake('sigkill');
    expect(killed.result).toMatchObject({ exitCode: 137, error: { code: 'killed', family: 'resource' } });
  });

  it('carries the child\'s error family, code and retryAfterMs through to the engine', async () => {
    const { result, events } = await runFake('quota');
    expect(result.error).toEqual({ code: 'rate_limited', family: 'transient_upstream', message: 'slow down', retryAfterMs: 90000, status: 429 });
    expect(events.find((e) => e.type === 'error')!.payload).toMatchObject({ code: 'quota_exhausted', family: 'provider_quota' });
  });
  it('passes debugWire and the timeouts to the child in init', async () => {
    const timed = { ...profile, timeouts: { connectMs: 5000, idleMs: 7000, requestMs: 9000 } };
    await runFake('replay', { options: { debugWire: true, maxTurnTokens: 1000 } }, adapterWith({ test: timed }));
    expect(record().init.run.options).toMatchObject({ debugWire: true, maxTurnTokens: 1000 });
    expect(record().init.provider.timeouts).toEqual({ connectMs: 5000, idleMs: 7000, requestMs: 9000 });
  });
  it('forwards log lines and stray output to the raw sink and unknown events as runtime.raw', async () => {
    const r = await runFake('noise');
    expect(r.raw).toEqual(expect.arrayContaining(['not json at all', '[warn] careful {"a":1}']));
    expect(r.events.map((e) => e.type)).toContain('runtime.raw');
    expect(r.result.finalText).toBe('ok');
  });
});

describe('a turn that cannot start', () => {
  const startsNothing = async (over: Partial<TurnInput>, adapter = adapterWith()) => { const k = sink(); const res = await adapter.runTurn(input('replay', over), k.s); return { res, k }; };
  it('needs a providerId/modelId', async () => {
    const { res, k } = await startsNothing({ model: null });
    expect(res.error).toMatchObject({ code: 'model_not_configured', family: 'tooling' });
    expect(k.spawns).toEqual([]);
  });
  it('names a provider that is not configured', async () => {
    const { res } = await startsNothing({ model: 'nope/x' });
    expect(res.error).toMatchObject({ code: 'provider_not_configured', family: 'tooling' });
  });
  it('is an auth error when the key is not in the run environment', async () => {
    const { res, k } = await startsNothing({ env: { [AC_ENV.RUN_ID]: 'run-1' } });
    expect(res.error).toMatchObject({ code: 'key_missing', family: 'auth' });
    expect(res.error!.message).toContain('WEAVE_LLM_TEST_KEY');
    expect(k.events.map((e) => e.type)).toEqual(['error']);
    expect(k.spawns).toEqual([]);
  });
});

describe('the provider key comes from the workspace secret store (VS-619)', () => {
  const STORE_KEY = 'sk-from-the-store-123';

  it('runs with no role on the key its own workspace holds, and keeps it off argv, the child env and the tool env', async () => {
    const seen: Array<[string, string | undefined]> = [];
    const a = createAdapter({ entry: FAKE, host: {
      providers: () => ({ test: profile }),
      providerKey: (id, ws) => { seen.push([id, ws]); return id === 'test' && ws === 'ws-1' ? STORE_KEY : undefined; },
    } });
    const k = sink();
    const r = await a.runTurn(input('replay', { env: { [AC_ENV.RUN_ID]: 'run-1' }, workspaceId: 'ws-1' }), k.s);
    expect(r.exitCode).toBe(0);
    const rec = record();
    expect(rec.init['provider']).toMatchObject({ id: 'test', baseUrl: profile.baseUrl, apiKey: STORE_KEY });
    expect(JSON.stringify(rec.argv)).not.toContain(STORE_KEY);
    expect(JSON.stringify(rec.env)).not.toContain(STORE_KEY);
    expect(JSON.stringify(rec.init['toolEnv'])).not.toContain(STORE_KEY);
    expect(seen).toContainEqual(['test', 'ws-1']);
  });

  it('lets a role-attached secret win over the store', async () => {
    const roleKey = 'sk-from-the-role-456';
    const a = createAdapter({ entry: FAKE, host: { providers: () => ({ test: profile }), providerKey: () => STORE_KEY } });
    const r = await a.runTurn(input('replay', { env: { [AC_ENV.RUN_ID]: 'run-1', WEAVE_LLM_TEST_KEY: roleKey }, workspaceId: 'ws-1' }), sink().s);
    expect(r.exitCode).toBe(0);
    expect(record().init['provider']).toMatchObject({ apiKey: roleKey });
  });

  it("resolves the profile and key of the run's own workspace, never another's", async () => {
    const other: ProviderProfile = { ...profile, baseUrl: 'https://other.example.test/v1' };
    const a = createAdapter({ entry: FAKE, host: {
      providers: (ws) => (ws === 'ws-2' ? { test: other } : { test: profile }),
      providerKey: (_id, ws) => (ws === 'ws-2' ? 'sk-ws-2-000' : 'sk-ws-1-000'),
    } });
    await a.runTurn(input('replay', { env: { [AC_ENV.RUN_ID]: 'run-1' }, workspaceId: 'ws-2' }), sink().s);
    expect(record().init['provider']).toMatchObject({ baseUrl: other.baseUrl, apiKey: 'sk-ws-2-000' });
  });

  it('names both places a missing key can be set', async () => {
    const { result } = await runFake('replay', { env: { [AC_ENV.RUN_ID]: 'run-1' }, workspaceId: 'ws-1' });
    expect(result.error).toMatchObject({ code: 'key_missing', family: 'auth' });
    expect(result.error!.message).toContain('Settings > Providers');
    expect(result.error!.message).toContain('role');
  });

  it('scopes model discovery to the workspace, using that workspace\'s profile and key', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ data: [{ id: 'x' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const w1: ProviderProfile = { ...profile, baseUrl: 'https://w1.example.test/v1', discover: true };
    const w2: ProviderProfile = { ...profile, baseUrl: 'https://w2.example.test/v1', discover: true };
    const a = createAdapter({ entry: FAKE, fetch: fetchFn, host: {
      providers: (ws) => (ws === 'ws-2' ? { test: w2 } : { test: w1 }),
      providerKey: (_id, ws) => (ws === 'ws-2' ? 'sk-ws-2-000' : 'sk-ws-1-000'),
    } });
    expect((await a.listModels('ws-2')).map((m) => m.id)).toEqual(['test/big-model', 'test/x']);
    expect(seen).toEqual([{ url: 'https://w2.example.test/v1/models', auth: 'Bearer sk-ws-2-000' }]);
  });
});

describe('the S2 events', () => {
  it('keeps file.changed, command.executed and tool.denied instead of folding them into runtime.raw', () => {
    for (const type of ['file.changed', 'command.executed', 'tool.denied']) {
      const line = parseChildLine(JSON.stringify({ t: 'event', ev: { ts: '2026-09-20T00:00:00Z', type, payload: { path: 'a.ts' } } }));
      expect(line).toMatchObject({ kind: 'event', ev: { type } });
    }
  });
});
