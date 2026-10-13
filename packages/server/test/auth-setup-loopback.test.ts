/** VS-797: first-time setup is loopback-only, and a proxy cannot launder a remote client into a loopback one. */
import { afterEach, describe, expect, it } from 'vitest';
import { initLogger } from '@weave-ai/core';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { ignoreLoopbackTrustOnPublicBind } from '../src/daemon.js';
import { makeHarness, type Harness } from './fakes.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const SETUP = { username: 'operator', password: 'correct horse battery' };

/** A request as the node server sees it: `peer` is the TCP remote address. */
function request(path: string, peer: string | undefined, init: RequestInit = {}) {
  const env = peer ? { incoming: { socket: { remoteAddress: peer } } } : {};
  return createApp(harness!.deps).fetch(new Request(`http://daemon.test${path}`, init), env);
}
const setup = (peer: string | undefined, headers: Record<string, string> = {}) =>
  request('/api/auth/setup', peer, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(SETUP) });

function start(opts: Parameters<typeof makeHarness>[0] = {}) {
  harness = makeHarness({ hasOperator: false, ...opts });
  return harness;
}
const setPasswordCalls = () => harness!.calls.filter((c) => c.service === 'auth' && c.method === 'setPassword');

describe('POST /api/auth/setup', () => {
  it('refuses a non-loopback peer and creates no operator, even with loopbackTrusted', async () => {
    start({ daemon: { auth: { loopbackTrusted: true } } });
    const res = await setup('192.168.1.40');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
    expect(setPasswordCalls()).toHaveLength(0);
  });

  it('refuses a request with no peer information', async () => {
    start();
    expect((await setup(undefined)).status).toBe(403);
    expect(setPasswordCalls()).toHaveLength(0);
  });

  it('accepts a loopback peer (the quickstart)', async () => {
    start();
    const res = await setup('127.0.0.1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(setPasswordCalls()[0]!.args).toEqual(['operator', 'correct horse battery']);
  });

  it.each(['::1', '::ffff:127.0.0.1', '127.0.0.5'])('accepts loopback peer %s', async (peer) => {
    start();
    expect((await setup(peer)).status).toBe(200);
    expect(setPasswordCalls()).toHaveLength(1);
  });

  it('accepts the loopback listener', async () => {
    start({ listener: 'loopback' });
    expect((await setup(undefined)).status).toBe(200);
    expect(setPasswordCalls()).toHaveLength(1);
  });

  it('refuses a same-host proxy forwarding a remote client, with and without trustProxy', async () => {
    for (const trustProxy of [false, true]) {
      start({ daemon: { http: { trustProxy } } });
      const res = await setup('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' });
      expect(res.status, `trustProxy=${trustProxy}`).toBe(403);
      expect(setPasswordCalls()).toHaveLength(0);
      await harness!.close(); harness = null;
    }
  });

  it('refuses any proxy header when trustProxy is off, even one naming a loopback client', async () => {
    start();
    expect((await setup('127.0.0.1', { 'x-forwarded-for': '127.0.0.1' })).status).toBe(403);
    expect((await setup('127.0.0.1', { 'x-real-ip': '127.0.0.1' })).status).toBe(403);
    expect((await setup('127.0.0.1', { forwarded: 'for=127.0.0.1' })).status).toBe(403);
  });

  it('uses the entry the trusted proxy appended, not one the client supplied', async () => {
    start({ daemon: { http: { trustProxy: true } } });
    // A remote client prepends 127.0.0.1; the proxy appends the real peer last.
    expect((await setup('127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' })).status).toBe(403);
    expect(setPasswordCalls()).toHaveLength(0);
    expect((await setup('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 127.0.0.1' })).status).toBe(200);
    expect(setPasswordCalls()).toHaveLength(1);
  });

  it('does not let a proxied remote client ride loopbackTrusted', async () => {
    start({ daemon: { auth: { loopbackTrusted: true } } });
    expect((await request('/api/w/ws1/tickets', '127.0.0.1')).status).toBe(200);
    expect((await request('/api/w/ws1/tickets', '127.0.0.1', { headers: { 'x-forwarded-for': '203.0.113.9' } })).status).toBe(401);
    expect((await request('/api/w/ws1/tickets', '192.168.1.40')).status).toBe(401);
  });
});

describe('ignoreLoopbackTrustOnPublicBind', () => {
  const cfg = (listen: string, loopbackTrusted: boolean) => DaemonConfigSchema.parse({ http: { listen }, auth: { loopbackTrusted } });

  it('drops loopbackTrusted for a non-loopback bind and warns', () => {
    const warnings: string[] = [];
    for (const listen of ['0.0.0.0:7433', '192.168.1.40:7433', '[::]:7433']) {
      const out = ignoreLoopbackTrustOnPublicBind(cfg(listen, true), (m) => warnings.push(m));
      expect(out.auth.loopbackTrusted, listen).toBe(false);
    }
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('auth.loopbackTrusted is ignored');
    expect(warnings[0]).toContain('0.0.0.0:7433');
  });

  it('keeps loopbackTrusted on a loopback bind, silently', () => {
    const warnings: string[] = [];
    for (const listen of ['127.0.0.1:7433', 'localhost:7433']) {
      expect(ignoreLoopbackTrustOnPublicBind(cfg(listen, true), (m) => warnings.push(m)).auth.loopbackTrusted, listen).toBe(true);
    }
    expect(warnings).toEqual([]);
  });

  it('leaves a config without the flag alone', () => {
    const c = cfg('0.0.0.0:7433', false);
    expect(ignoreLoopbackTrustOnPublicBind(c, () => { throw new Error('no warning expected'); })).toBe(c);
  });
});
