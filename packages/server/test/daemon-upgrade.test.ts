/** The three `/api/daemon/upgrade` routes (PLAN §20). */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, type Harness, type HarnessOptions } from './fakes.js';

let harness: Harness | null = null;
afterEach(() => { harness?.close(); harness = null; });

const app = (opts: HarnessOptions = {}) => {
  harness = makeHarness({ daemon: { upgrade: { source: '/src/agent-conductor', ref: 'main' } }, ...opts });
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

/** Poll an async predicate the background pipeline eventually satisfies. */
async function until(predicate: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition was never reached');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST', headers: { ...authed(), 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Holds the pipeline inside the build so an in-flight upgrade can be observed over HTTP. */
function heldBuild(): { opts: HarnessOptions; finish: () => void } {
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((r) => { finish = r; });
  return {
    opts: { upgrade: { build: async () => { await gate; return { path: '/rel/new', sha: 'nnnn' }; } } },
    finish: () => finish(),
  };
}

describe('GET /api/daemon/upgrade', () => {
  it('reports no upgrade before one has ever been requested', async () => {
    const { fetch } = app();
    const res = await fetch('/api/daemon/upgrade', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ upgrade: null, waitingFor: [] });
  });

  it('returns the record and its log tail while it is building', async () => {
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((r) => { finish = r; });
    const { h, fetch } = app({
      upgrade: { build: async (o) => { o.onOutput('$ pnpm build'); await gate; return { path: '/rel/new', sha: 'nnnn' }; } },
    });
    await fetch('/api/daemon/upgrade', post({}));
    await until(async () => (await (await fetch('/api/daemon/upgrade', { headers: authed() })).json()).upgrade.state === 'building');

    const body = await (await fetch('/api/daemon/upgrade', { headers: authed() })).json();
    expect(body.upgrade).toMatchObject({ state: 'building', source: '/src/agent-conductor', ref: 'main' });
    expect(body.upgrade.log).toEqual(['$ pnpm build']);
    expect(body.waitingFor).toEqual([]);

    finish();
    await h.deps.upgrades.settled();
  });

  it('reports the work a waiting upgrade is holding for', async () => {
    const { h, fetch } = app();
    h.impls.dispatcher!.running = () => 2;
    await fetch('/api/daemon/upgrade', post({}));
    await until(async () => (await (await fetch('/api/daemon/upgrade', { headers: authed() })).json()).upgrade.state === 'waiting');

    const body = await (await fetch('/api/daemon/upgrade', { headers: authed() })).json();
    expect(body.upgrade.state).toBe('waiting');
    expect(body.waitingFor).toEqual([{ workspace: 'ws1', running: 2, runIds: [] }]);

    await fetch('/api/daemon/upgrade/cancel', post({}));
    await h.deps.upgrades.settled();
  });
});

describe('POST /api/daemon/upgrade', () => {
  it('records the upgrade and answers 202 with it', async () => {
    const { h, fetch } = app();
    const res = await fetch('/api/daemon/upgrade', post({ ref: 'release' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ state: 'queued', ref: 'release', source: '/src/agent-conductor', requestedBy: 'op1' });
    await h.deps.upgrades.settled();
  });

  it('409s a second request while one is in flight', async () => {
    const held = heldBuild();
    const { h, fetch } = app(held.opts);
    expect((await fetch('/api/daemon/upgrade', post({}))).status).toBe(202);
    const second = await fetch('/api/daemon/upgrade', post({}));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('conflict');
    held.finish();
    await h.deps.upgrades.settled();
  });

  it('400s when the daemon has no release source configured', async () => {
    const { fetch } = app({ daemon: {} });
    const res = await fetch('/api/daemon/upgrade', post({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });
});

describe('POST /api/daemon/upgrade/cancel', () => {
  it('cancels a waiting upgrade and resumes dispatch', async () => {
    const { h, fetch } = app();
    h.impls.dispatcher!.running = () => 1;
    await fetch('/api/daemon/upgrade', post({}));
    await until(async () => (await (await fetch('/api/daemon/upgrade', { headers: authed() })).json()).upgrade.state === 'waiting');

    const res = await fetch('/api/daemon/upgrade/cancel', post({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'cancelled' });
    expect(h.calls.filter((c) => c.service === 'dispatcher' && c.method === 'start')).toHaveLength(1);

    h.impls.dispatcher!.running = () => 0;
    await h.deps.upgrades.settled();
    expect((await (await fetch('/api/daemon/upgrade', { headers: authed() })).json()).upgrade.state).toBe('cancelled');
  });

  it('409s once the build has started', async () => {
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((r) => { finish = r; });
    const { h, fetch } = app({ upgrade: { build: async () => { await gate; return { path: '/rel/new', sha: 'nnnn' }; } } });
    await fetch('/api/daemon/upgrade', post({}));
    await until(async () => (await (await fetch('/api/daemon/upgrade', { headers: authed() })).json()).upgrade.state === 'building');

    const res = await fetch('/api/daemon/upgrade/cancel', post({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('conflict');

    finish();
    await h.deps.upgrades.settled();
  });

  it('404s when nothing is in flight', async () => {
    const { fetch } = app();
    const res = await fetch('/api/daemon/upgrade/cancel', post({}));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});

describe('authorisation', () => {
  it('401s all three without a session', async () => {
    const { fetch } = app();
    expect((await fetch('/api/daemon/upgrade')).status).toBe(401);
    expect((await fetch('/api/daemon/upgrade', { method: 'POST' })).status).toBe(401);
    expect((await fetch('/api/daemon/upgrade/cancel', { method: 'POST' })).status).toBe(401);
  });

  it('refuses a run token on all three, and records nothing', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const token = await signRunToken(runTokenSecret(h.db), { workspaceId: 'ws1', agentId: 'ag_1', runId: 'run_1', scope: ['all'] });
    const bearer = { authorization: `Bearer ${token}` };
    for (const [path, init] of [
      ['/api/daemon/upgrade', { headers: bearer }],
      ['/api/daemon/upgrade', { method: 'POST', headers: bearer }],
      ['/api/daemon/upgrade/cancel', { method: 'POST', headers: bearer }],
    ] as Array<[string, RequestInit]>) {
      const res = await fetch(path, init);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    }
    expect(h.db.all('SELECT id FROM upgrades')).toHaveLength(0);
  });
});
