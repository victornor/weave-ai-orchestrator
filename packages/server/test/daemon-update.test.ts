/** `GET /api/daemon/update` (PLAN §20): what the web app's update indicator reads. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, type Harness, type HarnessOptions } from './fakes.js';

let harness: Harness | null = null;
const tmps: string[] = [];
afterEach(() => {
  harness?.close(); harness = null;
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

/** A release directory whose `<stamp>-<sha>` name is the only thing that has to resolve. */
function releaseRoot(sha = 'aaaaaaaaaa'): string {
  const home = mkdtempSync(join(tmpdir(), 'ac-upd-'));
  tmps.push(home);
  const root = join(home, `20260101-120000-${sha}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const app = (opts: HarnessOptions) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

describe('GET /api/daemon/update', () => {
  it('reports an update with the running and target commits', async () => {
    const { fetch } = app({
      daemon: { upgrade: { source: '/src/agent-conductor', ref: 'main' } },
      releaseRoot: releaseRoot('aaaaaaaaaa'),
      resolveRemote: () => 'b'.repeat(40),
    });
    const res = await fetch('/api/daemon/update', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      configured: true, updateAvailable: true, source: '/src/agent-conductor', ref: 'main',
      targetSha: 'b'.repeat(40), error: null,
      running: { version: '0.1.0-test', sha: 'aaaaaaaaaa' },
    });
  });

  it('reports no update when the source matches the running release', async () => {
    const { fetch } = app({
      daemon: { upgrade: { source: '/src', ref: 'main' } },
      releaseRoot: releaseRoot('aaaaaaaaaa'),
      resolveRemote: () => 'aaaaaaaaaa',
    });
    const body = await (await fetch('/api/daemon/update', { headers: authed() })).json();
    expect(body.updateAvailable).toBe(false);
    expect(body.targetSha).toBe('aaaaaaaaaa');
    expect(body.running.sha).toBe('aaaaaaaaaa');
  });

  it('reports "not configured" with no error when daemon.yaml names no source', async () => {
    const { fetch } = app({ releaseRoot: releaseRoot() });
    const body = await (await fetch('/api/daemon/update', { headers: authed() })).json();
    expect(body).toMatchObject({ configured: false, updateAvailable: false, error: null, source: null, ref: null, checkedAt: null });
  });

  it('reports the failure reason when the source cannot be reached', async () => {
    const { fetch } = app({
      daemon: { upgrade: { source: 'git@example.invalid:x.git', ref: 'main' } },
      releaseRoot: releaseRoot(),
      resolveRemote: () => { throw new Error('Could not resolve hostname'); },
    });
    const body = await (await fetch('/api/daemon/update', { headers: authed() })).json();
    expect(body.updateAvailable).toBe(false);
    expect(body.error).toContain('Could not resolve hostname');
  });

  it('re-resolves the source only when ?refresh=1 is asked for', async () => {
    let resolved = 0;
    const { fetch } = app({
      daemon: { upgrade: { source: '/src', ref: 'main' } },
      releaseRoot: releaseRoot(),
      resolveRemote: () => { resolved += 1; return 'b'.repeat(40); },
    });
    await fetch('/api/daemon/update', { headers: authed() });
    await fetch('/api/daemon/update', { headers: authed() });
    expect(resolved).toBe(1);
    await fetch('/api/daemon/update?refresh=1', { headers: authed() });
    expect(resolved).toBe(2);
  });

  it('401s without a session', async () => {
    const { fetch } = app({ releaseRoot: releaseRoot() });
    expect((await fetch('/api/daemon/update')).status).toBe(401);
  });

  it('refuses a run token: an agent cannot read the daemon update state', async () => {
    const { h, fetch } = app({ listener: 'loopback', releaseRoot: releaseRoot() });
    const token = await signRunToken(runTokenSecret(h.db), { workspaceId: 'ws1', agentId: 'ag_1', runId: 'run_1', scope: ['all'] });
    const res = await fetch('/api/daemon/update', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
  });
});
