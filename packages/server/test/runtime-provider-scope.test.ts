/**
 * VS-619: the runtime host and the models route keep provider profiles and keys to the workspace
 * that names them, so a second workspace defining the same provider id never uses the first's key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { ProviderProfile } from '@weave-ai/shared';
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
