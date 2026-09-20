/**
 * VS-619: the runtime host and the models route keep provider profiles and keys to the workspace
 * that names them, so a second workspace defining the same provider id never uses the first's key.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonSecretStore } from '@weave-ai/core';
import type { RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { DaemonConfig, ProviderProfile } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { createRuntimeHost } from '../src/daemon.js';
import type { WorkspaceRuntime } from '../src/types.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const profile = (baseUrl: string): ProviderProfile => ({ baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'PROVIDER_KEY', models: {} });

/** The parts of a WorkspaceRuntime the host reads; a test names its own workspace this way. */
const workspace = (id: string, providers: Record<string, ProviderProfile>, key: string | undefined): WorkspaceRuntime =>
  ({ id, ctx: { config: { providers } }, services: { secrets: { value: (): string | undefined => key } } } as unknown as WorkspaceRuntime);

describe('createRuntimeHost', () => {
  it('resolves a named workspace to its own providers and key, and nothing for an unknown one', () => {
    const w1 = profile('https://w1.example.test/v1');
    const w2 = profile('https://w2.example.test/v1');
    const host = createRuntimeHost(new Map([
      ['w1', workspace('w1', { or: w1 }, 'sk-w1-000000')],
      ['w2', workspace('w2', { or: w2 }, 'sk-w2-000000')],
    ]));
    expect(host.providers('w2')['or']).toBe(w2);
    expect(host.providerKey!('or', 'w2')).toBe('sk-w2-000000');
    expect(host.providers('ghost')).toEqual({});
    expect(host.providerKey!('or', 'ghost')).toBeUndefined();
  });

  // VS-633: the daemon's providers reach every workspace; a workspace's own entry replaces one.
  it('gives every workspace the daemon providers, a workspace entry replacing the same id', () => {
    const d = profile('https://daemon.example.test/v1');
    const w = profile('https://w1.example.test/v1');
    const daemon = { providers: { or: d, only: d } } as unknown as DaemonConfig;
    const host = createRuntimeHost(new Map([
      ['w1', workspace('w1', { or: w }, undefined)],
      ['w2', workspace('w2', {}, undefined)],
    ]), undefined, daemon);
    expect(host.providers('w1')['or']).toBe(w);
    expect(host.providers('w1')['only']).toBe(d);
    expect(host.providers('w2')['or']).toBe(d);
    expect(host.providers()['or']).toBe(d);
  });

  it('finds a provider key in the daemon store when the workspace holds none, and prefers the workspace one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-host-'));
    try {
      daemonSecretStore(dir)!.put('PROVIDER_KEY', 'sk-daemon-000000');
      const daemon = { providers: { or: profile('https://daemon.example.test/v1') } } as unknown as DaemonConfig;
      const host = createRuntimeHost(new Map([
        ['w1', workspace('w1', {}, undefined)],
        ['w2', workspace('w2', {}, 'sk-w2-000000')],
      ]), dir, daemon);
      expect(host.providerKey!('or', 'w1')).toBe('sk-daemon-000000');
      expect(host.providerKey!('or', 'w2')).toBe('sk-w2-000000');
      expect(host.providerKey!('or')).toBe('sk-daemon-000000');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('exposes the daemon config directory to a runtime, and nothing when none is given (VS-615)', () => {
    expect(createRuntimeHost(new Map(), '/srv/weave-config').configDir).toBe('/srv/weave-config');
    expect(createRuntimeHost(new Map())).not.toHaveProperty('configDir');
  });

  it('keeps the aggregate, first workspace defining an id winning, for a caller with no workspace', () => {
    const w1 = profile('https://w1.example.test/v1');
    const w2 = profile('https://w2.example.test/v1');
    const host = createRuntimeHost(new Map([
      ['w1', workspace('w1', { or: w1 }, 'sk-w1-000000')],
      ['w2', workspace('w2', { or: w2 }, 'sk-w2-000000')],
    ]));
    expect(host.providers()['or']).toBe(w1);
    expect(host.providerKey!('or')).toBe('sk-w1-000000');
  });
});

describe('GET /runtimes/:id/models', () => {
  const get = (h: Harness, path: string): Promise<Response> =>
    createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api${path}`, { headers: authed() }));

  it('passes the named workspace to the adapter, and 404s one that is not loaded', async () => {
    harness = makeHarness();
    const seen: Array<string | undefined> = [];
    const adapter = {
      id: 'weave', displayName: 'Weave', capabilities: {},
      detect: async () => ({ status: 'available' }),
      listModels: async (workspaceId?: string) => { seen.push(workspaceId); return [{ id: 'p/m', label: 'm', provider: 'p', source: 'static' }]; },
      configSchema: () => ({}), installInstructions: async () => undefined,
      runTurn: async () => ({ exitCode: 0, signal: null, timedOut: false, session: null, finalText: null }),
    } as unknown as RuntimeAdapter;
    harness.deps.registries.runtimes.set('weave', adapter);

    const scoped = await get(harness, '/runtimes/weave/models?workspace=ws1');
    expect(scoped.status).toBe(200);
    expect(await scoped.json()).toEqual([{ id: 'p/m', label: 'm', provider: 'p', source: 'static' }]);
    expect(seen).toEqual(['ws1']);
    expect((await get(harness, '/runtimes/weave/models')).status).toBe(200);
    expect(seen).toEqual(['ws1', undefined]);
    expect((await get(harness, '/runtimes/weave/models?workspace=ghost')).status).toBe(404);
    expect(seen).toEqual(['ws1', undefined]);
  });

  it('404s a runtime that is not registered', async () => {
    harness = makeHarness();
    expect((await get(harness, '/runtimes/nope/models')).status).toBe(404);
  });
});
