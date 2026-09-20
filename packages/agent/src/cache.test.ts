import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRequest } from './codec/chatCompletions.js';
import { completeCompat } from './codec/params.js';
import { runAgentTurn, type LoopDeps } from './loop.js';
import type { InitMessage } from './protocol.js';
import { startMockProvider, textChunks, type MockProvider } from './testkit/mockProvider.js';

const tools = [{ name: 'read', description: 'r', parameters: { type: 'object' } }, { name: 'bash', description: 'b', parameters: { type: 'object' } }];
const base = { model: 'm', system: 'SYS', messages: [{ role: 'user' as const, text: 'one' }, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'two' }] }, { role: 'user' as const, text: 'three' }], tools, options: {} };
const build = (promptCache: 'none' | 'key' | 'anthropic' | undefined, over: Record<string, unknown> = {}, cacheKey: string | null = 'sess-1') =>
  buildRequest({ ...base, compat: completeCompat({ ...(promptCache ? { promptCache } : {}), ...over }), ...(cacheKey ? { cacheKey } : {}) });

describe('prompt caching flags', () => {
  it('sends nothing for none or unset, and nothing for a one-off request without a key', () => {
    for (const b of [build(undefined), build('none'), build('key', {}, null), build('anthropic', {}, null)]) {
      expect(JSON.stringify(b)).not.toContain('cache_control');
      expect(b).not.toHaveProperty('prompt_cache_key');
    }
  });
  it('key mode sends prompt_cache_key equal to the session id and no markers', () => {
    const b = build('key');
    expect(b['prompt_cache_key']).toBe('sess-1');
    expect(JSON.stringify(b)).not.toContain('cache_control');
  });
  it('omitParams can still strip the key', () => {
    expect(build('key', { omitParams: ['prompt_cache_key'] })).not.toHaveProperty('prompt_cache_key');
  });
  it('anthropic mode marks the system message, the last user message and the last tool, and only those', () => {
    const b = build('anthropic');
    const msgs = b['messages'] as Array<{ role: string; content: unknown }>;
    expect(msgs[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }] });
    expect(msgs[1]).toEqual({ role: 'user', content: 'one' });
    expect(msgs[3]).toEqual({ role: 'user', content: [{ type: 'text', text: 'three', cache_control: { type: 'ephemeral' } }] });
    const t = b['tools'] as Array<Record<string, unknown>>;
    expect(t[0]).not.toHaveProperty('cache_control');
    expect(t[1]!['cache_control']).toEqual({ type: 'ephemeral' });
    expect(b).not.toHaveProperty('prompt_cache_key');
  });
});

describe('cached tokens', () => {
  let dir: string; let mock: MockProvider;
  beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-cache-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
  afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });
  const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
  const init = (compat?: InitMessage['provider']['compat']): InitMessage => ({
    type: 'init', v: 1,
    run: { runId: 'run-abc123', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'b' }, limits: { timeoutMs: 600_000 }, permission: { mode: 'auto' }, model: 'mock-model', options: {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'k', ...(compat ? { compat } : {}) },
    prompt: 'go', systemPrompt: { text: '', mode: 'skip' }, session: { path: join(dir, 's.jsonl'), id: 'sess-42' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
  });
  const noop = { emit: () => undefined, partial: () => undefined, log: () => undefined };

  it('flows the standard cached_tokens field into usage.firstRequest', async () => {
    mock.script({ chunks: textChunks('hi', 'mock-model', { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 64 } }) });
    const r = await runAgentTurn(init(), noop, new AbortController().signal, fast);
    expect(r.usage).toMatchObject({ inputTokens: 36, cachedInputTokens: 64, contextTokens: 100, firstRequest: { freshTokens: 36, cachedTokens: 64 } });
  });
  it('reads a provider-specific field named by cachedTokensField', async () => {
    mock.script({ chunks: textChunks('hi', 'mock-model', { prompt_tokens: 100, completion_tokens: 5, cache: { read: 80 } }) });
    const r = await runAgentTurn(init({ cachedTokensField: 'cache.read' }), noop, new AbortController().signal, fast);
    expect(r.usage!.firstRequest).toEqual({ freshTokens: 20, cachedTokens: 80 });
  });
  it('sends the session id as the key when the profile says key, and nothing when it does not', async () => {
    mock.script({ chunks: textChunks('a') }, { chunks: textChunks('b') });
    await runAgentTurn(init({ promptCache: 'key' }), noop, new AbortController().signal, fast);
    expect(mock.requests[0]!.body['prompt_cache_key']).toBe('sess-42');
    rmSync(join(dir, 's.jsonl'));
    await runAgentTurn(init(), noop, new AbortController().signal, fast);
    expect(mock.requests[1]!.body).not.toHaveProperty('prompt_cache_key');
  });
});
