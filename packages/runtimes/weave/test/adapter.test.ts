import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AC_ENV, RUNTIME_PARTIAL_OUTPUT, validateRuntimeOptions, type ProviderProfile } from '@weave-ai/shared';
import type { RuntimeEvent, RuntimePartial, TurnHandle, TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import { capabilities, createAdapter } from '../src/index.js';
import { parseChildLine } from '../src/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-agent.mjs');
const KEY = 'sk-adapter-secret-789';
const profile: ProviderProfile = { baseUrl: 'https://llm.example.test/v1', apiKeySecret: 'WEAVE_LLM_TEST_KEY', auth: 'bearer', headers: {}, models: { 'big-model': { contextWindow: 128000 } } };
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
  it('validates only the four option keys', () => {
    const schema = adapterWith().configSchema();
    expect(validateRuntimeOptions(schema, { temperature: 0.2, topP: 0.5, maxOutputTokens: 100, contextWindowTokens: 8000 }).valid).toBe(true);
    expect(validateRuntimeOptions(schema, { temperature: 3 }).valid).toBe(false);
    expect(validateRuntimeOptions(schema, { frequencyPenalty: 1 }).byKey).toEqual({ frequencyPenalty: 'not an option this runtime understands' });
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
