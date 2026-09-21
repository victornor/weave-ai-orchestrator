import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonSecretStore } from '@weave-ai/core';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
let server: Server | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await harness?.close(); harness = null;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A tiny OpenAI-compatible endpoint: models, a stream (text or tool call by prompt), and the two output-cap spellings. */
async function endpoint(): Promise<{ baseUrl: string; seen: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> }> {
  const seen: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
  server = createServer((req, res) => {
    let s = ''; req.on('data', (c) => (s += c));
    req.on('end', () => {
      const body = s ? JSON.parse(s) as Record<string, unknown> : {};
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body });
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'm1' }] })); return; }
      if (body['stream'] !== true) {
        // Honours max_tokens, ignores max_completion_tokens (the recorded Z.ai behaviour).
        const cap = 'max_tokens' in body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ finish_reason: cap ? 'length' : 'stop' }], usage: { completion_tokens: cap ? 16 : 51 } })); return;
      }
      const tools = Array.isArray(body['tools']);
      const chunks = tools
        ? [{ model: 'm1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{"city":"Paris"}' } }] }, finish_reason: 'tool_calls' }] }, { model: 'm1', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }]
        : [{ model: 'm1', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] }, { model: 'm1', choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

/** A harness with a scratch daemon config dir (so the daemon store and `daemon.yaml` never touch the host). */
function withDir(): { dir: string; h: Harness } {
  const dir = mkdtempSync(join(tmpdir(), 'vs654-providers-'));
  dirs.push(dir);
  const h = makeHarness({ daemonConfigDir: dir });
  harness = h;
  return { dir, h };
}

const dreq = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/daemon/providers${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));
const wreq = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));

const profile = (baseUrl: string) => ({ baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_D_KEY', models: { m1: {} } });

describe('daemon provider administration', () => {
  it('lists each provider with its secret state and model ids, and the preset catalogue, never a key', async () => {
    const { dir, h } = withDir();
    await dreq(h, 'PUT', '/openrouter', { baseUrl: 'https://openrouter.ai/api/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_OPENROUTER_KEY', models: { 'deepseek/deepseek-r1': {} } });
    await dreq(h, 'PUT', '/local', { baseUrl: 'http://127.0.0.1:11434/v1', auth: 'none', headers: {}, models: { llama: {} } });
    await dreq(h, 'POST', '/openrouter/secret', { value: 'sk-not-real-000000' });
    const res = await dreq(h, 'GET', '');
    expect(res.status).toBe(200);
    const json = await res.json() as { providers: Array<{ id: string; secretConfigured: boolean; models: string[]; source: string }>; presets: Array<{ id: string; description: string }> };
    expect(json.providers.map((p) => `${p.id}:${p.secretConfigured}:${p.models.join(',')}:${p.source}`)).toEqual(['openrouter:true:deepseek/deepseek-r1:daemon', 'local:false:llama:daemon']);
    expect(json.presets.map((p) => p.id)).toContain('openai');
    expect(json.presets.find((p) => p.id === 'openai')?.description).toBeTruthy();
    expect(JSON.stringify(json)).not.toContain('sk-not-real');
    expect(daemonSecretStore(dir)!.get('WEAVE_LLM_OPENROUTER_KEY')).toBe('sk-not-real-000000');
  });

  it('creates, updates and removes a profile in daemon.yaml, and refuses an invalid one without writing', async () => {
    const { dir, h } = withDir();
    const created = await dreq(h, 'PUT', '/example', { baseUrl: 'https://api.example.test/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_EXAMPLE_KEY', models: { m1: { contextWindow: 8000 } } });
    expect(created.status).toBe(200);
    expect((await created.json() as { models: string[] }).models).toEqual(['m1']);
    expect(readFileSync(join(dir, 'daemon.yaml'), 'utf8')).toContain('example:');
    // A malformed profile is a validation 400 and does not write.
    const bad = await dreq(h, 'PUT', '/example', { baseUrl: 'not a url' });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: { code: string } }).error.code).toBe('validation');
    // Remove.
    expect((await dreq(h, 'DELETE', '/example')).status).toBe(200);
    expect((await (await dreq(h, 'GET', '')).json() as { providers: unknown[] }).providers).toEqual([]);
    expect((await dreq(h, 'DELETE', '/example')).status).toBe(404);
  });

  it('sets and clears a provider key in the daemon store, never returning its value', async () => {
    const { dir, h } = withDir();
    await dreq(h, 'PUT', '/mock', { baseUrl: 'http://127.0.0.1:1/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', models: { m1: {} } });
    await dreq(h, 'PUT', '/nokeyname', { baseUrl: 'http://127.0.0.1:1/v1', auth: 'none', headers: {}, models: {} });
    const set = await dreq(h, 'POST', '/mock/secret', { value: 'sk-secret-value-000' });
    expect(set.status).toBe(200);
    const setJson = await set.json() as { ok: boolean; configured: boolean; secretName: string };
    expect(setJson).toMatchObject({ ok: true, configured: true, secretName: 'WEAVE_LLM_MOCK_KEY' });
    expect(JSON.stringify(setJson)).not.toContain('sk-secret-value');
    expect(daemonSecretStore(dir)!.has('WEAVE_LLM_MOCK_KEY')).toBe(true);
    // The workspace store is not written and does not shadow the daemon key.
    expect(h.runtime.services.secrets.has('WEAVE_LLM_MOCK_KEY')).toBe(false);
    // A profile that names no apiKeySecret has nowhere to hold one.
    const refused = await dreq(h, 'POST', '/nokeyname/secret', { value: 'sk-x' });
    expect(refused.status).toBe(400);
    // Clear.
    const cleared = await dreq(h, 'DELETE', '/mock/secret');
    expect((await cleared.json() as { configured: boolean }).configured).toBe(false);
    expect(daemonSecretStore(dir)!.has('WEAVE_LLM_MOCK_KEY')).toBe(false);
  });
});

describe('POST /api/daemon/providers/:id/test', () => {
  it('runs the probes with the daemon provider\'s secret and reports each capability, never the key', async () => {
    const { h } = withDir();
    const ep = await endpoint();
    await dreq(h, 'PUT', '/mock', { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', preset: 'openai', models: { m1: {} } });
    await dreq(h, 'POST', '/mock/secret', { value: 'held' });
    const res = await dreq(h, 'POST', '/mock/test', {});
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; provider: string; model: string; checks: Array<{ name: string; ok: boolean }>; detected: Record<string, unknown> };
    expect(json).toMatchObject({ ok: true, provider: 'mock', model: 'm1' });
    expect(json.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)).toEqual(['PASS models list', 'PASS streamed answer', 'PASS usage reported', 'PASS tool call', 'PASS output cap']);
    expect(json.detected).toEqual({ maxTokensParam: 'max_tokens' });
    expect(ep.seen.map((s) => s.auth)).toEqual(Array(5).fill('Bearer held'));
    expect(JSON.stringify(json)).not.toContain('held');
  });
  it('names a missing secret without calling the endpoint', async () => {
    const { h } = withDir();
    const ep = await endpoint();
    await dreq(h, 'PUT', '/nokey', { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_NOKEY_KEY', models: { m1: {} } });
    const json = await (await dreq(h, 'POST', '/nokey/test', {})).json() as { ok: boolean; checks: Array<{ detail: string }> };
    expect(json.ok).toBe(false);
    expect(json.checks[0]!.detail).toContain('WEAVE_LLM_NOKEY_KEY');
    expect(ep.seen).toHaveLength(0);
  });
  it('404s an unknown provider and asks for a model when the profile lists none', async () => {
    const { h } = withDir();
    expect((await dreq(h, 'POST', '/ghost/test', {})).status).toBe(404);
    await dreq(h, 'PUT', '/bare', { baseUrl: 'http://127.0.0.1:1/v1', auth: 'none', headers: {}, models: {} });
    const res = await dreq(h, 'POST', '/bare/test', {});
    expect(res.status).toBe(400);
    const err = await res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe('validation');
    expect(err.error.message).toBe('provider bare has no models; add one on the Providers page or pass a model to test');
  });
  it('uses a model named in the body even when the profile lists none (VS-635)', async () => {
    const { h } = withDir();
    const ep = await endpoint();
    await dreq(h, 'PUT', '/mock', { baseUrl: ep.baseUrl, auth: 'none', headers: {}, preset: 'openai', models: {} });
    const res = await dreq(h, 'POST', '/mock/test', { model: 'typed-model' });
    expect(res.status).toBe(200);
    expect((await res.json() as { model: string }).model).toBe('typed-model');
    expect(ep.seen.every((s) => (s.body['model'] ?? 'typed-model') === 'typed-model')).toBe(true);
  });
});

// VS-635: the on-demand model discovery behind the Settings models editor.
describe('POST /api/daemon/providers/:id/discover', () => {
  it('returns the endpoint\'s ids with the daemon-stored key, and never the key', async () => {
    const { h } = withDir();
    const ep = await endpoint();
    await dreq(h, 'PUT', '/mock', { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', models: {} });
    await dreq(h, 'POST', '/mock/secret', { value: 'sk-discovery-key' });
    const res = await dreq(h, 'POST', '/mock/discover', {});
    expect(res.status).toBe(200);
    const json = await res.json() as { provider: string; ok: boolean; models: Array<{ id: string }> };
    expect(json).toMatchObject({ provider: 'mock', ok: true });
    expect(json.models.map((m) => m.id)).toEqual(['m1']);
    expect(ep.seen.at(-1)!.auth).toBe('Bearer sk-discovery-key');
    expect(JSON.stringify(json)).not.toContain('sk-discovery-key');
  });

  it('fetches against a draft profile before it is saved, and with a key typed but not saved', async () => {
    const { h } = withDir();
    const ep = await endpoint();
    // The stored profile points at a dead port; the body carries the real endpoint and the typed key.
    await dreq(h, 'PUT', '/draft', { baseUrl: 'http://127.0.0.1:1/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_DRAFT_KEY', models: {} });
    const res = await dreq(h, 'POST', '/draft/discover', {
      profile: { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_DRAFT_KEY', models: {} },
      apiKey: 'sk-typed-not-saved',
    });
    expect(await res.json()).toMatchObject({ provider: 'draft', ok: true, models: [{ id: 'm1' }] });
    expect(ep.seen.at(-1)!.auth).toBe('Bearer sk-typed-not-saved');
  });

  it('names a failure in one line and returns no ids', async () => {
    const { h } = withDir();
    const dead = createServer((_req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('nope'); });
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    try {
      await dreq(h, 'PUT', '/bad', { baseUrl: `http://127.0.0.1:${(dead.address() as AddressInfo).port}/v1`, auth: 'none', headers: {}, models: {} });
      const json = await (await dreq(h, 'POST', '/bad/discover', {})).json() as { ok: boolean; models: unknown[]; error: string };
      expect(json.ok).toBe(false);
      expect(json.models).toEqual([]);
      expect(json.error).toBe('HTTP 500');
    } finally { await new Promise<void>((r) => dead.close(() => r())); }
  });

  it('404s an unknown provider', async () => {
    const { h } = withDir();
    expect((await dreq(h, 'POST', '/ghost/discover', {})).status).toBe(404);
  });
});

// VS-654: providers are daemon-only. There is no workspace provider surface, and a legacy workspace block is inert.
describe('providers are daemon-only', () => {
  it('does not mount any workspace provider route', async () => {
    const { h } = withDir();
    expect((await wreq(h, 'GET', '/providers')).status).toBe(404);
    expect((await wreq(h, 'PUT', '/providers/x', profile('https://x.test/v1'))).status).toBe(404);
    expect((await wreq(h, 'POST', '/providers/x/secret', { value: 'sk-x' })).status).toBe(404);
    expect((await wreq(h, 'POST', '/providers/x/test', {})).status).toBe(404);
    expect((await wreq(h, 'POST', '/providers/x/disable')).status).toBe(404);
    expect((await wreq(h, 'DELETE', '/providers/x/disable')).status).toBe(404);
  });

  it('still returns a legacy workspace provider block from the workspace config, unused by the daemon routes', async () => {
    const { h } = withDir();
    h.runtime.ctx.config.providers['legacy'] = { baseUrl: 'https://legacy.test/v1', auth: 'bearer', headers: {}, models: {} };
    h.runtime.ctx.config.disabledProviders = ['something'];
    // The daemon's own list is unaffected by a workspace block.
    expect((await (await dreq(h, 'GET', '')).json() as { providers: unknown[]; presets: unknown[] }).providers).toEqual([]);
    // The workspace config still carries the retained fields.
    const summary = await (await wreq(h, 'GET', '')).json() as { config: { providers: Record<string, unknown>; disabledProviders: string[] } };
    expect(Object.keys(summary.config.providers)).toEqual(['legacy']);
    expect(summary.config.disabledProviders).toEqual(['something']);
  });

  it('refuses a run token on the daemon routes', async () => {
    const { h } = withDir();
    h.deps.listener = 'loopback';
    const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'p1', ticketId: null, roleId: null, planId: null, firstTurn: false } as never);
    const res = await createApp(h.deps).fetch(new Request('http://127.0.0.1:7433/api/daemon/providers/x', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(profile('https://d.example.test/v1')) }));
    expect(res.status).toBe(403);
  });
});
