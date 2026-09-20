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
afterEach(async () => { await harness?.close(); harness = null; await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null; });

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

const post = (h: Harness, path: string, payload: unknown = {}) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
const req = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));

/** Make `saveConfig` real enough for a route test: it swaps the in-memory config, as the daemon's does. */
function persistConfig(h: Harness): { saved: Array<{ providers: Record<string, unknown> }> } {
  const saved: Array<{ providers: Record<string, unknown> }> = [];
  h.runtime.ctx.saveConfig = async (next) => { saved.push(next as never); h.runtime.ctx.config = next; };
  return { saved };
}

describe('provider administration', () => {
  it('lists each provider with its secret state and model ids, and the preset catalogue, never a key', async () => {
    harness = makeHarness();
    harness.runtime.ctx.config.providers['openrouter'] = { baseUrl: 'https://openrouter.ai/api/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_OPENROUTER_KEY', models: { 'deepseek/deepseek-r1': {} } };
    harness.runtime.ctx.config.providers['local'] = { baseUrl: 'http://127.0.0.1:11434/v1', auth: 'none', headers: {}, models: { llama: {} } };
    harness.runtime.services.secrets.put({ kind: 'human', id: 'h' } as never, { name: 'WEAVE_LLM_OPENROUTER_KEY' }, 'sk-not-real-000000');
    const res = await req(harness, 'GET', '/providers');
    expect(res.status).toBe(200);
    const json = await res.json() as { providers: Array<{ id: string; secretConfigured: boolean; models: string[] }>; presets: Array<{ id: string; description: string }> };
    expect(json.providers.map((p) => `${p.id}:${p.secretConfigured}:${p.models.join(',')}`)).toEqual(['openrouter:true:deepseek/deepseek-r1', 'local:false:llama']);
    expect(json.presets.map((p) => p.id)).toContain('openai');
    expect(json.presets.find((p) => p.id === 'openai')?.description).toBeTruthy();
    expect(JSON.stringify(json)).not.toContain('sk-not-real');
  });

  it('creates, updates and removes a profile, and refuses an invalid one without writing', async () => {
    harness = makeHarness();
    const { saved } = persistConfig(harness);
    const profile = { baseUrl: 'https://api.example.test/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_EXAMPLE_KEY', models: { m1: { contextWindow: 8000 } } };
    const created = await req(harness, 'PUT', '/providers/example', profile);
    expect(created.status).toBe(200);
    expect((await created.json() as { models: string[] }).models).toEqual(['m1']);
    expect(Object.keys(saved.at(-1)!.providers)).toEqual(['example']);
    // A malformed profile is a validation 400 and does not write.
    const before = saved.length;
    const bad = await req(harness, 'PUT', '/providers/example', { baseUrl: 'not a url' });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: { code: string } }).error.code).toBe('validation');
    expect(saved).toHaveLength(before);
    // Remove.
    expect((await req(harness, 'DELETE', '/providers/example')).status).toBe(200);
    expect(saved.at(-1)!.providers).toEqual({});
    expect((await req(harness, 'DELETE', '/providers/example')).status).toBe(404);
  });

  it('sets and clears a provider key, never returning its value', async () => {
    harness = makeHarness();
    harness.runtime.ctx.config.providers['mock'] = { baseUrl: 'http://127.0.0.1:1/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', models: { m1: {} } };
    harness.runtime.ctx.config.providers['nokeyname'] = { baseUrl: 'http://127.0.0.1:1/v1', auth: 'none', headers: {}, models: {} };
    const set = await post(harness, '/providers/mock/secret', { value: 'sk-secret-value-000' });
    expect(set.status).toBe(200);
    const setJson = await set.json() as { ok: boolean; configured: boolean; secretName: string };
    expect(setJson).toMatchObject({ ok: true, configured: true, secretName: 'WEAVE_LLM_MOCK_KEY' });
    expect(JSON.stringify(setJson)).not.toContain('sk-secret-value');
    expect(harness.runtime.services.secrets.has('WEAVE_LLM_MOCK_KEY')).toBe(true);
    // A profile that names no apiKeySecret has nowhere to hold one.
    const refused = await post(harness, '/providers/nokeyname/secret', { value: 'sk-x' });
    expect(refused.status).toBe(400);
    // Clear.
    const cleared = await req(harness, 'DELETE', '/providers/mock/secret');
    expect((await cleared.json() as { configured: boolean }).configured).toBe(false);
    expect(harness.runtime.services.secrets.has('WEAVE_LLM_MOCK_KEY')).toBe(false);
  });
});


describe('POST /providers/:id/test', () => {
  it('runs the probes with the provider\'s secret and reports each capability, never the key', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    harness.runtime.ctx.config.providers['mock'] = { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', preset: 'openai', models: { m1: {} } };
    harness.runtime.services.secrets.put({ kind: 'human', id: 'h' } as never, { name: 'WEAVE_LLM_MOCK_KEY' }, 'held');
    const res = await post(harness, '/providers/mock/test');
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; provider: string; model: string; checks: Array<{ name: string; ok: boolean }>; detected: Record<string, unknown> };
    expect(json).toMatchObject({ ok: true, provider: 'mock', model: 'm1' });
    expect(json.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)).toEqual(['PASS models list', 'PASS streamed answer', 'PASS usage reported', 'PASS tool call', 'PASS output cap']);
    expect(json.detected).toEqual({ maxTokensParam: 'max_tokens' });
    expect(ep.seen.map((s) => s.auth)).toEqual(Array(5).fill('Bearer held'));
    expect(JSON.stringify(json)).not.toContain('held');
  });
  it('names a missing secret without calling the endpoint', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    harness.runtime.ctx.config.providers['nokey'] = { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_NOKEY_KEY', models: { m1: {} } };
    const json = await (await post(harness, '/providers/nokey/test')).json() as { ok: boolean; checks: Array<{ detail: string }> };
    expect(json.ok).toBe(false);
    expect(json.checks[0]!.detail).toContain('WEAVE_LLM_NOKEY_KEY');
    expect(ep.seen).toHaveLength(0);
  });
  it('404s an unknown provider and asks for a model when the profile lists none', async () => {
    harness = makeHarness();
    expect((await post(harness, '/providers/ghost/test')).status).toBe(404);
    harness.runtime.ctx.config.providers['bare'] = { baseUrl: 'http://127.0.0.1:1/v1', auth: 'none', headers: {}, models: {} };
    const res = await post(harness, '/providers/bare/test');
    expect(res.status).toBe(400);
    const err = await res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe('validation');
    expect(err.error.message).toBe('provider bare has no models; add one on the Providers page or pass a model to test');
  });
  it('uses a model named in the body even when the profile lists none (VS-635)', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    harness.runtime.ctx.config.providers['mock'] = { baseUrl: ep.baseUrl, auth: 'none', headers: {}, preset: 'openai', models: {} };
    const res = await post(harness, '/providers/mock/test', { model: 'typed-model' });
    expect(res.status).toBe(200);
    expect((await res.json() as { model: string }).model).toBe('typed-model');
    expect(ep.seen.every((s) => (s.body['model'] ?? 'typed-model') === 'typed-model')).toBe(true);
  });
});

// VS-635: the on-demand model discovery behind the Settings models editor.
describe('POST /providers/:id/discover', () => {
  const dreq = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/daemon/providers${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));

  it('returns the endpoint\'s ids with the stored key, and never the key', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    harness.runtime.ctx.config.providers['mock'] = { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', models: {} };
    harness.runtime.services.secrets.put({ kind: 'human', id: 'h' } as never, { name: 'WEAVE_LLM_MOCK_KEY' }, 'sk-discovery-key');
    const res = await post(harness, '/providers/mock/discover');
    expect(res.status).toBe(200);
    const json = await res.json() as { provider: string; ok: boolean; models: Array<{ id: string }> };
    expect(json).toMatchObject({ provider: 'mock', ok: true });
    expect(json.models.map((m) => m.id)).toEqual(['m1']);
    // The workspace store's value was used (the fake records it as `held`), and no value is returned.
    expect(ep.seen.at(-1)!.auth).toBe('Bearer held');
    expect(JSON.stringify(json)).not.toContain('held');
  });

  it('fetches against a draft profile before it is saved, and with a key typed but not saved', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    // The stored profile points at a dead port; the body carries the real endpoint and the typed key.
    harness.runtime.ctx.config.providers['draft'] = { baseUrl: 'http://127.0.0.1:1/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_DRAFT_KEY', models: {} };
    const res = await post(harness, '/providers/draft/discover', {
      profile: { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_DRAFT_KEY', models: {} },
      apiKey: 'sk-typed-not-saved',
    });
    expect(await res.json()).toMatchObject({ provider: 'draft', ok: true, models: [{ id: 'm1' }] });
    expect(ep.seen.at(-1)!.auth).toBe('Bearer sk-typed-not-saved');
    expect(harness.runtime.services.secrets.has('WEAVE_LLM_DRAFT_KEY')).toBe(false);
  });

  it('names a failure in one line and returns no ids', async () => {
    harness = makeHarness();
    const dead = createServer((_req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('nope'); });
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    try {
      harness.runtime.ctx.config.providers['bad'] = { baseUrl: `http://127.0.0.1:${(dead.address() as AddressInfo).port}/v1`, auth: 'none', headers: {}, models: {} };
      const json = await (await post(harness, '/providers/bad/discover')).json() as { ok: boolean; models: unknown[]; error: string };
      expect(json.ok).toBe(false);
      expect(json.models).toEqual([]);
      expect(json.error).toBe('HTTP 500');
    } finally { await new Promise<void>((r) => dead.close(() => r())); }
  });

  it('discovers a daemon provider from the daemon scope with its daemon key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vs635-discover-'));
    const h = makeHarness({ daemonConfigDir: dir });
    harness = h;
    try {
      const ep = await endpoint();
      await dreq(h, 'PUT', '/dp', { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_D_KEY', models: {} });
      await dreq(h, 'POST', '/dp/secret', { value: 'sk-daemon-disco' });
      const json = await (await dreq(h, 'POST', '/dp/discover', {})).json() as { ok: boolean; models: Array<{ id: string }> };
      expect(json).toMatchObject({ ok: true, models: [{ id: 'm1' }] });
      expect(ep.seen.at(-1)!.auth).toBe('Bearer sk-daemon-disco');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('404s an unknown provider', async () => {
    harness = makeHarness();
    expect((await post(harness, '/providers/ghost/discover')).status).toBe(404);
  });
});

// VS-633: the daemon scope, and the merged, marked view a workspace gets.
describe('daemon-level providers', () => {
  const dreq = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/daemon/providers${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));
  const scratchDir = (): string => mkdtempSync(join(tmpdir(), 'vs633-daemon-'));
  const profile = (baseUrl: string) => ({ baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_D_KEY', models: { m1: {} } });
  const withDir = (): { dir: string; h: Harness } => { const dir = scratchDir(); const h = makeHarness({ daemonConfigDir: dir }); return { dir, h }; };

  it('creates a provider in daemon.yaml, visible to a workspace marked from the daemon, and removes it', async () => {
    const { dir, h } = withDir(); harness = h;
    try {
      const put = await dreq(h, 'PUT', '/dp', profile('https://d.example.test/v1'));
      expect(put.status).toBe(200);
      expect(readFileSync(join(dir, 'daemon.yaml'), 'utf8')).toContain('dp:');
      const ws = await (await req(h, 'GET', '/providers')).json() as { providers: Array<{ id: string; source: string }> };
      expect(ws.providers.map((p) => `${p.id}:${p.source}`)).toEqual(['dp:daemon']);
      expect((await dreq(h, 'DELETE', '/dp')).status).toBe(200);
      expect((await (await req(h, 'GET', '/providers')).json() as { providers: unknown[] }).providers).toEqual([]);
      expect((await dreq(h, 'DELETE', '/dp')).status).toBe(404);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('holds a daemon key in the daemon store: found by a workspace with no secret, never returned, cleared on request', async () => {
    const { dir, h } = withDir(); harness = h;
    try {
      await dreq(h, 'PUT', '/dp', profile('https://d.example.test/v1'));
      const set = await dreq(h, 'POST', '/dp/secret', { value: 'sk-daemon-secret-0000' });
      expect(await set.json()).toMatchObject({ ok: true, configured: true, secretName: 'WEAVE_LLM_D_KEY' });
      expect(daemonSecretStore(dir)!.get('WEAVE_LLM_D_KEY')).toBe('sk-daemon-secret-0000');
      expect(h.runtime.services.secrets.has('WEAVE_LLM_D_KEY')).toBe(false);
      const daemonList = await (await dreq(h, 'GET', '')).text();
      const wsList = await (await req(h, 'GET', '/providers')).text();
      expect(daemonList).not.toContain('sk-daemon-secret');
      expect(wsList).not.toContain('sk-daemon-secret');
      expect(JSON.parse(wsList).providers[0]).toMatchObject({ id: 'dp', secretConfigured: true });
      await dreq(h, 'DELETE', '/dp/secret');
      expect(JSON.parse(await (await req(h, 'GET', '/providers')).text()).providers[0].secretConfigured).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a workspace overrides a daemon provider whole, and removing the override restores it', async () => {
    const { dir, h } = withDir(); harness = h;
    try {
      persistConfig(h);
      await dreq(h, 'PUT', '/dp', profile('https://d.example.test/v1'));
      // Inherited entries cannot be edited or given a key from the workspace scope.
      expect((await req(h, 'DELETE', '/providers/dp')).status).toBe(400);
      expect((await post(h, '/providers/dp/secret', { value: 'sk-x-000000' })).status).toBe(400);
      const over = await req(h, 'PUT', '/providers/dp', { ...profile('https://w.example.test/v1'), models: { other: {} } });
      expect(await over.json()).toMatchObject({ source: 'override', models: ['other'] });
      expect(h.runtime.ctx.daemon.providers['dp']!.baseUrl).toBe('https://d.example.test/v1');
      expect((await req(h, 'DELETE', '/providers/dp')).status).toBe(200);
      const back = await (await req(h, 'GET', '/providers')).json() as { providers: Array<{ id: string; source: string; profile: { baseUrl: string } }> };
      expect(back.providers.map((p) => `${p.id}:${p.source}:${p.profile.baseUrl}`)).toEqual(['dp:daemon:https://d.example.test/v1']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a workspace can disable an inherited provider and enable it again', async () => {
    const { dir, h } = withDir(); harness = h;
    try {
      persistConfig(h);
      await dreq(h, 'PUT', '/dp', profile('https://d.example.test/v1'));
      expect((await req(h, 'POST', '/providers/dp/disable')).status).toBe(200);
      const hidden = await (await req(h, 'GET', '/providers')).json() as { providers: unknown[]; disabled: Array<{ id: string }> };
      expect(hidden.providers).toEqual([]);
      expect(hidden.disabled.map((d) => d.id)).toEqual(['dp']);
      expect((await req(h, 'DELETE', '/providers/dp/disable')).status).toBe(200);
      expect((await (await req(h, 'GET', '/providers')).json() as { providers: unknown[] }).providers).toHaveLength(1);
      expect((await req(h, 'POST', '/providers/ghost/disable')).status).toBe(404);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('tests a daemon provider from the daemon scope with its daemon key, and from a workspace that inherits it', async () => {
    const { dir, h } = withDir(); harness = h;
    try {
      const ep = await endpoint();
      await dreq(h, 'PUT', '/dp', { ...profile(ep.baseUrl), preset: 'openai' });
      const noKey = await (await dreq(h, 'POST', '/dp/test', {})).json() as { ok: boolean; checks: Array<{ detail: string }> };
      expect(noKey.ok).toBe(false);
      expect(noKey.checks[0]!.detail).toContain('WEAVE_LLM_D_KEY');
      await dreq(h, 'POST', '/dp/secret', { value: 'held-daemon-key' });
      const ok = await (await dreq(h, 'POST', '/dp/test', {})).json() as { ok: boolean };
      expect(ok.ok).toBe(true);
      expect((await (await post(h, '/providers/dp/test', {})).json() as { ok: boolean }).ok).toBe(true);
      expect(new Set(ep.seen.filter((s) => s.auth).map((s) => s.auth))).toEqual(new Set(['Bearer held-daemon-key']));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a run token on the daemon routes', async () => {
    const { dir, h } = withDir(); harness = h;
    try {
      h.deps.listener = 'loopback';
      const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'p1', ticketId: null, roleId: null, planId: null, firstTurn: false } as never);
      const res = await createApp(h.deps).fetch(new Request('http://127.0.0.1:7433/api/daemon/providers/x', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(profile('https://d.example.test/v1')) }));
      expect(res.status).toBe(403);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
