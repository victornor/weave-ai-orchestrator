/**
 * VS-633: a worker option on the built-in agent that names a provider defined only in the daemon
 * settings. It is created through the daemon Models route, its models are listed with no workspace
 * configuration at all, and a turn on it reaches the provider with the key held in the daemon store.
 * The child is the runtime package's own fake agent, so nothing calls a real endpoint.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonSecretStore } from '@weave-ai/core';
import { createAdapter } from '@weave-ai/runtime-weave';
import { AC_ENV } from '@weave-ai/shared';
import type { TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import { createApp } from '../src/app.js';
import { createRuntimeHost } from '../src/daemon.js';
import { authed, makeHarness, type Harness } from './fakes.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'runtimes', 'weave', 'test', 'fake-agent.mjs');
let harness: Harness | null = null;
let dir = '';
afterEach(async () => { await harness?.close(); harness = null; if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

const call = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));

describe('a worker option on a daemon-level provider', () => {
  it('is created in the daemon catalog, lists its models with no workspace config, and runs with the daemon-held key', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vs633-opt-'));
    const cfgDir = join(dir, 'config');
    const runDir = join(dir, 'run');
    mkdirSync(cfgDir); mkdirSync(runDir);
    harness = makeHarness({ daemonConfigDir: cfgDir });
    const h = harness;
    const KEY = 'sk-daemon-provider-key-123';

    // The real host and adapter over the harness's live daemon config and workspace.
    const host = createRuntimeHost(h.deps.workspaces, cfgDir, h.deps.daemon);
    const adapter = createAdapter({ entry: FAKE, host, fetch: (async () => new Response(JSON.stringify({ data: [{ id: 'detected-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch });
    h.deps.registries.runtimes.set('weave', adapter);
    expect(Object.keys(h.runtime.ctx.config.providers)).toEqual([]);

    // Configure the provider once, in the daemon, with its key in the daemon store.
    const profile = { baseUrl: 'https://llm.example.test/v1', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_DP_KEY', models: { m1: {} } };
    expect((await call(h, 'PUT', '/daemon/providers/dp', profile)).status).toBe(200);
    expect((await call(h, 'POST', '/daemon/providers/dp/secret', { value: KEY })).status).toBe(200);
    expect(daemonSecretStore(cfgDir)!.get('WEAVE_LLM_DP_KEY')).toBe(KEY);

    // Create the worker option in the daemon Models catalog.
    const put = await call(h, 'PUT', '/daemon/models', { workerOptions: [{ id: 'agent', description: 'The built-in agent on the daemon provider', runtime: 'weave', model: 'dp/m1', options: { temperature: 0.2 } }] });
    expect(put.status).toBe(200);
    expect((await (await call(h, 'GET', '/daemon/models')).json() as { workerOptions: Array<{ id: string; runtime: string; model: string }> }).workerOptions[0]).toMatchObject({ id: 'agent', runtime: 'weave', model: 'dp/m1' });

    // The runtime lists that provider's models for the daemon Models editor (no workspace) and for the workspace.
    const daemonList = await (await call(h, 'GET', '/runtimes/weave/models')).json() as Array<{ id: string }>;
    expect(daemonList.map((m) => m.id)).toEqual(expect.arrayContaining(['dp/m1', 'dp/detected-model']));
    const wsList = await (await call(h, 'GET', '/runtimes/weave/models?workspace=ws1')).json() as Array<{ id: string }>;
    expect(wsList.map((m) => m.id)).toEqual(expect.arrayContaining(['dp/m1']));

    // A turn on that option in a workspace with no provider and no secret of its own.
    const events: unknown[] = [];
    const sink: TurnSink = { onSpawn: () => undefined, onEvent: (e) => events.push(e), onRaw: () => undefined, onPartial: () => undefined };
    const input: TurnInput = {
      runId: 'run-1', turnEpoch: 1, cwd: runDir, worktree: { path: join(runDir, 'wt'), branch: 'ac/x' },
      session: { policy: 'resume', ref: null, isFirstTurn: true }, systemPrompt: { text: 'SYS', mode: 'inject' }, prompt: 'replay',
      mcpServers: {}, env: { [AC_ENV.RUN_ID]: 'run-1' }, options: { temperature: 0.2 }, limits: { timeoutMs: 60_000 },
      permission: { mode: 'auto' }, model: 'dp/m1', configHome: join(runDir, 'cfg'), workspaceId: 'ws1',
    };
    const result = await adapter.runTurn(input, sink);
    expect(result.exitCode).toBe(0);
    const rec = JSON.parse(readFileSync(join(runDir, 'record.json'), 'utf8')) as { argv: string[]; env: Record<string, string>; init: Record<string, any> };
    expect(rec.init['provider']).toMatchObject({ id: 'dp', baseUrl: profile.baseUrl, apiKey: KEY });
    expect(JSON.stringify(rec.argv)).not.toContain(KEY);
    expect(JSON.stringify(rec.env)).not.toContain(KEY);
  });

  it('discovers a daemon provider\'s models, saves the picked one, and offers it to a daemon worker option (VS-635)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vs635-opt-'));
    const cfgDir = join(dir, 'config');
    mkdirSync(cfgDir);
    harness = makeHarness({ daemonConfigDir: cfgDir });
    const h = harness;

    // The discovery route uses the real runtime function with the global fetch, so give it a local endpoint.
    const modelsServer = createServer((req, res) => {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'detected-model', context_length: 8192 }] })); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => modelsServer.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${(modelsServer.address() as AddressInfo).port}/v1`;

    const host = createRuntimeHost(h.deps.workspaces, cfgDir, h.deps.daemon);
    const adapter = createAdapter({
      entry: FAKE,
      host,
      fetch: (async () => new Response(JSON.stringify({ data: [{ id: 'detected-model', context_length: 8192 }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    h.deps.registries.runtimes.set('weave', adapter);

    try {
      // A codeify-shaped provider: base URL, no models, key in the daemon store.
      const bare = { baseUrl, preset: 'openrouter', auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_DP_KEY', models: {} };
      expect((await call(h, 'PUT', '/daemon/providers/dp', bare)).status).toBe(200);
      expect((await call(h, 'POST', '/daemon/providers/dp/secret', { value: 'sk-daemon' })).status).toBe(200);

      // Fetch from the endpoint, then the editor saves the picked model.
      const discovered = await (await call(h, 'POST', '/daemon/providers/dp/discover', {})).json() as { ok: boolean; models: Array<{ id: string; contextWindow?: number }> };
      expect(discovered.ok).toBe(true);
      expect(discovered.models).toEqual([{ id: 'detected-model', contextWindow: 8192 }]);
      const saved = await call(h, 'PUT', '/daemon/providers/dp', { ...bare, models: { 'detected-model': { contextWindow: 8192 } } });
      expect(saved.status).toBe(200);
      expect((await saved.json() as { models: string[] }).models).toEqual(['detected-model']);

      // The Models editor on the daemon sees it, and a worker option can name it, in a workspace with no provider config.
      expect(Object.keys(h.runtime.ctx.config.providers)).toEqual([]);
      const list = await (await call(h, 'GET', '/runtimes/weave/models')).json() as Array<{ id: string }>;
      expect(list.map((m) => m.id)).toContain('dp/detected-model');
      expect((await call(h, 'PUT', '/daemon/models', { workerOptions: [{ id: 'builtin', description: 'The built-in agent', runtime: 'weave', model: 'dp/detected-model' }] })).status).toBe(200);
    } finally {
      await new Promise<void>((r) => modelsServer.close(() => r()));
    }
  });
});
