/**
 * VS-654: providers are daemon-only. The runtime host resolves the daemon's provider profiles and the
 * daemon secret store whatever workspace a run belongs to; a legacy workspace `providers` block
 * (VS-619/VS-633 once gave it a per-workspace profile and key) changes nothing.
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
const workspace = (id: string, providers: Record<string, ProviderProfile>): WorkspaceRuntime =>
  ({ id, ctx: { config: { providers } }, services: { secrets: { value: (): string => 'sk-workspace-should-not-win' } } } as unknown as WorkspaceRuntime);

describe('createRuntimeHost', () => {
  it('resolves the daemon providers for any workspace, and a workspace block changes nothing', () => {
    const d = profile('https://daemon.example.test/v1');
    const w = profile('https://w1.example.test/v1');
    const daemon = { providers: { or: d, only: d } } as unknown as DaemonConfig;
    const host = createRuntimeHost(new Map([
      ['w1', workspace('w1', { or: w })],
      ['w2', workspace('w2', {})],
    ]), undefined, daemon);
    expect(host.providers('w1')['or']).toBe(d);
    expect(host.providers('w2')['only']).toBe(d);
    expect(host.providers()['or']).toBe(d);
    // The id is not looked up at all: an unknown workspace is no different.
    expect(host.providers('ghost')['or']).toBe(d);
  });

  it('resolves a provider key from the daemon store only, never a workspace store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vs654-host-'));
    try {
      daemonSecretStore(dir)!.put('PROVIDER_KEY', 'sk-daemon-000000');
      const daemon = { providers: { or: profile('https://daemon.example.test/v1') } } as unknown as DaemonConfig;
      const host = createRuntimeHost(new Map([
        ['w1', workspace('w1', {})],
        ['w2', workspace('w2', {})],
      ]), dir, daemon);
      expect(host.providerKey!('or', 'w1')).toBe('sk-daemon-000000');
      expect(host.providerKey!('or', 'w2')).toBe('sk-daemon-000000');
      expect(host.providerKey!('or')).toBe('sk-daemon-000000');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('exposes the daemon config directory to a runtime, and nothing when none is given (VS-615)', () => {
    expect(createRuntimeHost(new Map(), '/srv/weave-config').configDir).toBe('/srv/weave-config');
    expect(createRuntimeHost(new Map())).not.toHaveProperty('configDir');
  });

  it('resolves nothing for a provider the daemon does not define', () => {
    const daemon = { providers: {} } as unknown as DaemonConfig;
    const host = createRuntimeHost(new Map([
      ['w1', workspace('w1', { or: profile('https://w1.example.test/v1') })],
    ]), undefined, daemon);
    expect(host.providers('w1')).toEqual({});
    expect(host.providerKey!('or', 'w1')).toBeUndefined();
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
