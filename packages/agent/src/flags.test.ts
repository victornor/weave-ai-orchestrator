import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ProviderProfileSchema } from '@weave-ai/shared';
import { runAgentTurn, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { loadPreset, resolveProvider } from './resolve.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-flags-')); mkdirSync(join(dir, 'wt')); writeFileSync(join(dir, 'wt', 'a.txt'), 'alpha\n'); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

const YAML = `
preset: zai
baseUrl: BASE
apiKeySecret: WEAVE_LLM_Z_KEY
params: { temperature: 0.2 }
compat: { omitParams: [presence_penalty], reasoning: { effortParam: reasoning_effort } }
models:
  glm-x: { params: { topP: 0.9 } }
`;

function init(profileYaml: string, over: { options?: Record<string, unknown>; effort?: string; session?: string; prompt?: string } = {}): InitMessage {
  const profile = ProviderProfileSchema.parse(parseYaml(profileYaml.replace('BASE', mock.baseUrl)));
  const modelId = Object.keys(profile.models)[0] ?? 'glm-x';
  const resolved = resolveProvider({ preset: loadPreset(profile.preset ?? 'openai-compatible'), profile, model: profile.models[modelId], options: over.options });
  return {
    type: 'init', v: 1,
    run: { runId: 'run-flags1', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'b' }, limits: { timeoutMs: 600_000 }, permission: { mode: 'auto' }, model: modelId, ...(over.effort ? { effort: over.effort } : {}), options: over.options ?? {}, spillDir: join(dir, 'spill') },
    provider: { id: 'p', baseUrl: profile.baseUrl, auth: profile.auth, headers: profile.headers, apiKey: 'sk-flags', compat: JSON.parse(JSON.stringify(resolved.compat)), params: resolved.params },
    prompt: over.prompt ?? 'go', systemPrompt: { text: '', mode: 'skip' }, session: { path: join(dir, over.session ?? 's.jsonl'), id: 's1' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}
const io = (): { io: LoopIO; events: ChildEvent[]; logs: string[] } => { const events: ChildEvent[] = []; const logs: string[] = []; return { events, logs, io: { emit: (e) => events.push(e), partial: () => undefined, log: (_l, m) => logs.push(m) } }; };
const fast = { sleep: async () => undefined, partialFlushMs: 1 };
const run = (i: InitMessage) => { const h = io(); return runAgentTurn(i, h.io, new AbortController().signal, fast).then((result) => ({ result, ...h })); };

describe('a provider defined only by YAML runs a mock turn', () => {
  it('sends the preset\'s output-cap name, the layered parameters, effort, and none of the omitted or unset ones', async () => {
    mock.script({ chunks: textChunks('done') });
    const r = await run(init(YAML, { options: { maxOutputTokens: 300, presencePenalty: 0.4 }, effort: 'high' }));
    expect(r.result.exitCode).toBe(0);
    expect(r.result.finalText).toBe('done');
    const body = mock.requests[0]!.body;
    expect(body).toMatchObject({ model: 'glm-x', max_tokens: 300, temperature: 0.2, top_p: 0.9, reasoning_effort: 'high' });
    for (const k of ['max_completion_tokens', 'presence_penalty', 'frequency_penalty', 'seed', 'stop']) expect(body).not.toHaveProperty(k);
    expect(mock.requests[0]!.headers['authorization']).toBe('Bearer sk-flags');
  });
  it('a bare generic profile with nothing set sends only the model, messages, stream flags and tools', async () => {
    mock.script({ chunks: textChunks('ok') });
    await run(init('baseUrl: BASE\nmodels: { m: {} }\n'));
    expect(Object.keys(mock.requests[0]!.body).sort()).toEqual(['messages', 'model', 'stream', 'stream_options', 'tools']);
  });
});

describe('reasoning pass-back through the loop', () => {
  const DEEPSEEK = 'preset: deepseek\nbaseUrl: BASE\nmodels: { r1: {} }\n';
  const thinkingTool = (id: string, thought: string): unknown[] => [
    { choices: [{ index: 0, delta: { reasoning_content: thought } }] },
    ...toolCallChunks([{ id, name: 'read', args: '{"path":"a.txt"}' }]),
  ];
  it('echoes reasoning_content on the current turn\'s tool step only, and drops it from earlier turns', async () => {
    mock.script({ chunks: thinkingTool('c1', 'first thoughts') }, { chunks: textChunks('turn one done') });
    await run(init(DEEPSEEK, { prompt: 'one' }));
    // second request of turn one: the tool step's own reasoning is echoed
    const secondReq = mock.requests[1]!.body['messages'] as Array<Record<string, unknown>>;
    expect(secondReq.find((m) => m['role'] === 'assistant' && m['tool_calls'])!['reasoning_content']).toBe('first thoughts');

    mock.script({ chunks: textChunks('turn two done') });
    await run(init(DEEPSEEK, { prompt: 'two' }));
    const third = mock.requests[2]!.body['messages'] as Array<Record<string, unknown>>;
    expect(third.filter((m) => m['role'] === 'assistant').some((m) => 'reasoning_content' in m)).toBe(false);
  });
  it('a profile with passBack none never echoes it', async () => {
    mock.script({ chunks: thinkingTool('c1', 'secret thoughts') }, { chunks: textChunks('done') });
    await run(init('baseUrl: BASE\nmodels: { m: {} }\n'));
    const second = mock.requests[1]!.body['messages'] as Array<Record<string, unknown>>;
    expect(second.some((m) => 'reasoning_content' in m)).toBe(false);
  });
});

describe('endpoint failures', () => {
  it('maps a 402 to provider_quota and asks only once', async () => {
    mock.script({ status: 402, body: '{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}' });
    const r = await run(init('baseUrl: BASE\nmodels: { m: {} }\n'));
    expect(r.result.error).toMatchObject({ family: 'provider_quota', code: 'quota_exhausted' });
    expect(mock.requests).toHaveLength(1);
  });
  it('retries a gateway that already exhausted its routes once, not the usual number of times', async () => {
    const body = '{"error":{"message":"All available provider routes failed after 6 attempts. If it keeps happening, contact support and quote the request id.","type":"api_error","param":null,"code":"upstream_error"}}';
    mock.script(...Array.from({ length: 4 }, () => ({ status: 502, body })));
    const r = await run(init('baseUrl: BASE\nmodels: { m: {} }\n'));
    expect(r.result.error).toMatchObject({ code: 'gateway_routes_failed', family: 'transient_upstream' });
    expect(mock.requests).toHaveLength(2);
  });
  it('an ordinary 502 still gets the default retries', async () => {
    mock.script(...Array.from({ length: 4 }, () => ({ status: 502, body: '{"error":{"message":"bad gateway"}}' })));
    const r = await run(init('baseUrl: BASE\nmodels: { m: {} }\n'));
    expect(r.result.error?.family).toBe('transient_upstream');
    expect(mock.requests).toHaveLength(3);
  });
});

describe('think tags in content', () => {
  it('splits <think> into thinking and keeps the rest as the answer', async () => {
    mock.script({ chunks: textChunks('<think>hmm</think>The answer.') });
    const r = await run(init('baseUrl: BASE\ncompat: { reasoning: { field: think_tags } }\nmodels: { m: {} }\n'));
    expect(r.result.finalText).toBe('The answer.');
    expect(r.events.find((e) => e.type === 'assistant.thinking')!.payload['text']).toBe('hmm');
  });
});
