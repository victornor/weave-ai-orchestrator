/**
 * VS-579: the workspace read reports the effective worker memory limit *and where it came from*, so
 * Settings can show a derived number honestly rather than as a value someone set.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

describe('GET /api/w/:ws workerMemory (VS-579)', () => {
  it('reports the derived value when unset and the workspace value once set', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const ctx = harness.runtime.ctx;
    // The fake's saveConfig is a no-op; make it actually store, as the real loader does.
    ctx.saveConfig = async (next) => { ctx.config = next as typeof ctx.config; };
    const app = createApp(harness.deps);

    const first = await app.fetch(new Request('http://127.0.0.1/api/w/ws1', { headers: authed() }));
    const before = await first.json() as { workerMemory: { mb: number; source: string } };
    expect(before.workerMemory.source).toBe('derived');
    expect(before.workerMemory.mb).toBeGreaterThanOrEqual(1024);

    const patch = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/config', {
      method: 'PATCH',
      headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ defaults: { workerMemoryMb: 4096 } }),
    }));
    expect(patch.status).toBe(200);

    const second = await app.fetch(new Request('http://127.0.0.1/api/w/ws1', { headers: authed() }));
    const after = await second.json() as { workerMemory: { mb: number; source: string } };
    expect(after.workerMemory).toEqual({ mb: 4096, source: 'workspace' });
  });
});
