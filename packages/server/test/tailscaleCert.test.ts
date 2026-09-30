/**
 * VS-765: `http.tls.mode: tailscale`. The LocalAPI stub speaks the shapes captured from tailscaled
 * 1.102.4 (status JSON, a `type=pair` body with the private key first, the plain-text 500 for an
 * unknown name); the daemon tests use an in-process `TailscaleClient` stub.
 */
import { createServer, type Server } from 'node:http';
import { connect, type TLSSocket } from 'node:tls';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initLogger, workspaceLoader } from '@weave-ai/core';
import { startDaemon, type DaemonHandle } from '../src/daemon.js';
import {
  TailscaleError, certNotAfter, fetchTailscaleCert, localApiClient, parsePair, resolveTailscaleCert, startCertRenewal,
  type TailscaleClient, type TailscaleStatus,
} from '../src/tailscaleCert.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

const NAME = 'myhost.tailnet-name.ts.net';

async function makeCert(days: number, cn = NAME): Promise<{ cert: string; key: string }> {
  const selfsigned = (await import('selfsigned')) as { generate: (attrs: unknown, opts: unknown) => { cert: string; private: string } };
  const pems = selfsigned.generate([{ name: 'commonName', value: cn }], {
    days, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: cn }, { type: 7, ip: '127.0.0.1' }] }],
  });
  return { cert: pems.cert, key: pems.private };
}

const RUNNING: TailscaleStatus = { backendState: 'Running', dnsName: NAME, certDomains: [NAME] };

function stubClient(o: { status?: () => Promise<TailscaleStatus>; certs: () => Promise<{ cert: string; key: string }> }): TailscaleClient & { certCalls: number; statusCalls: number } {
  const c = {
    certCalls: 0, statusCalls: 0,
    status() { c.statusCalls += 1; return (o.status ?? (() => Promise.resolve(RUNNING)))(); },
    cert() { c.certCalls += 1; return o.certs(); },
  };
  return c;
}

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ac-ts-'));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

async function localApiStub(handler: (path: string) => { status: number; body: string }): Promise<string> {
  const sock = join(tmp(), 'tailscaled.sock');
  const server: Server = createServer((req, res) => {
    const r = handler(req.url ?? '');
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(r.body);
  });
  await new Promise<void>((res) => { server.listen(sock, () => res()); });
  cleanup.push(() => new Promise<void>((res) => { server.close(() => res()); }));
  return sock;
}

describe('LocalAPI client', () => {
  it('reads the tailnet name and loads a certificate pair, key first', async () => {
    const { cert, key } = await makeCert(90);
    const sock = await localApiStub((path) => {
      if (path === '/localapi/v0/status') {
        return { status: 200, body: JSON.stringify({ Version: '1.102.4', BackendState: 'Running', Self: { DNSName: `${NAME}.` }, CertDomains: [NAME] }) };
      }
      if (path === `/localapi/v0/cert/${NAME}?type=pair`) return { status: 200, body: `${key}${cert}` };
      return { status: 404, body: 'not found' };
    });
    const client = localApiClient(sock);
    expect(await client.status()).toEqual({ backendState: 'Running', dnsName: NAME, certDomains: [NAME] });
    const resolved = await fetchTailscaleCert(client, []);
    expect(resolved.domain).toBe(NAME);
    expect(resolved.cert).toContain('BEGIN CERTIFICATE');
    expect(resolved.key).toContain('PRIVATE KEY');
    expect(resolved.notAfter.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
  });

  it('asks for the first configured domain instead of the tailnet name', async () => {
    const { cert, key } = await makeCert(90, 'alt.example.ts.net');
    const asked: string[] = [];
    const sock = await localApiStub((path) => {
      if (path.endsWith('/status')) return { status: 200, body: JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${NAME}.` }, CertDomains: [NAME, 'alt.example.ts.net'] }) };
      asked.push(path);
      return { status: 200, body: `${key}${cert}` };
    });
    const resolved = await fetchTailscaleCert(localApiClient(sock), ['alt.example.ts.net']);
    expect(resolved.domain).toBe('alt.example.ts.net');
    expect(asked).toEqual(['/localapi/v0/cert/alt.example.ts.net?type=pair']);
  });

  it('reports a missing socket as Tailscale not running', async () => {
    const client = localApiClient(join(tmp(), 'absent.sock'));
    await expect(client.status()).rejects.toMatchObject({ code: 'unreachable', message: expect.stringMatching(/Tailscale is not running/) });
  });

  it('names the admin-console setting when the tailnet offers no certificate domains', async () => {
    const sock = await localApiStub(() => ({ status: 200, body: JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${NAME}.` }, CertDomains: null }) }));
    const err = await fetchTailscaleCert(localApiClient(sock), []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TailscaleError);
    expect((err as TailscaleError).code).toBe('https_disabled');
    expect((err as TailscaleError).message).toMatch(/HTTPS Certificates.*admin console/);
  });

  it('names `tailscale set --operator` when the user may not fetch certificates', async () => {
    const sock = await localApiStub(() => ({ status: 403, body: 'Access denied' }));
    const err = await localApiClient(sock).cert(NAME).catch((e: unknown) => e);
    expect((err as TailscaleError).code).toBe('forbidden');
    expect((err as TailscaleError).message).toMatch(/tailscale set --operator/);
  });

  it('refuses a domain tailscaled did not offer, with the real 500 body kept in the message', async () => {
    const sock = await localApiStub(() => ({ status: 500, body: `invalid domain "foo.example.com"; must be one of ["${NAME}"]\n` }));
    const err = await localApiClient(sock).cert('foo.example.com').catch((e: unknown) => e);
    expect((err as TailscaleError).code).toBe('failed');
    expect((err as TailscaleError).message).toContain('must be one of');
  });

  it('parses a pair body and rejects one without a key', async () => {
    const { cert, key } = await makeCert(90);
    expect(parsePair(`${key}${cert}${cert}`, NAME).cert.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
    expect(() => parsePair(cert, NAME)).toThrow(/private key/);
  });
});

describe('start-up wait', () => {
  it('starts once tailscale becomes available within the wait', async () => {
    const good = await makeCert(90);
    let calls = 0;
    const client = stubClient({
      status: () => { calls += 1; return calls < 4 ? Promise.reject(new TailscaleError('unreachable', 'Tailscale is not running')) : Promise.resolve(RUNNING); },
      certs: () => Promise.resolve(good),
    });
    const sleeps: number[] = [];
    const resolved = await resolveTailscaleCert(client, { domains: [], waitMs: 60_000, retryMs: 5_000, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
    expect(resolved.domain).toBe(NAME);
    expect(sleeps).toEqual([5_000, 5_000, 5_000]);
  });

  it('waits through a not-Running backend state as well', async () => {
    const good = await makeCert(90);
    const states = ['NoState', 'Starting', 'Running'];
    const client = stubClient({ status: () => Promise.resolve({ ...RUNNING, backendState: states.shift()! }), certs: () => Promise.resolve(good) });
    const resolved = await resolveTailscaleCert(client, { domains: [], sleep: () => Promise.resolve() });
    expect(resolved.domain).toBe(NAME);
    expect(client.statusCalls).toBe(3);
  });

  it('fails with the not-running message after the bound, having retried', async () => {
    const client = stubClient({ status: () => Promise.reject(new TailscaleError('unreachable', 'Tailscale is not running (cannot reach /x)')), certs: () => Promise.reject(new Error('unused')) });
    let clock = 0;
    const err = await resolveTailscaleCert(client, { domains: [], waitMs: 20_000, retryMs: 5_000, now: () => clock, sleep: (ms) => { clock += ms; return Promise.resolve(); } }).catch((e: unknown) => e);
    expect((err as TailscaleError).message).toMatch(/Tailscale is not running/);
    expect(client.statusCalls).toBe(5);
  });

  it('does not wait on a permanent cause', async () => {
    const client = stubClient({ status: () => Promise.resolve({ ...RUNNING, certDomains: [] }), certs: () => Promise.reject(new Error('unused')) });
    const err = await resolveTailscaleCert(client, { domains: [], sleep: () => { throw new Error('must not sleep'); } }).catch((e: unknown) => e);
    expect((err as TailscaleError).code).toBe('https_disabled');
    expect(client.statusCalls).toBe(1);
  });
});

describe('renewal', () => {
  it('applies a fresh certificate inside the window and leaves a distant one alone', async () => {
    const soon = await makeCert(10);
    const fresh = await makeCert(90);
    const client = stubClient({ certs: () => Promise.resolve(fresh) });
    const applied: string[] = [];
    const current = { ...soon, domain: NAME, notAfter: certNotAfter(soon.cert) };
    const handle = startCertRenewal({ client, domains: [], current, apply: (p) => applied.push(p.cert), checkMs: 20, windowMs: 30 * 86_400_000 });
    cleanup.push(() => handle.stop());
    await vi_waitFor(() => applied.length >= 1);
    expect(applied[0]).toBe(fresh.cert);
    // Now the stored certificate is the fresh 90-day one: no further fetch happens.
    const callsAfter = client.certCalls;
    await new Promise((r) => { setTimeout(r, 120); });
    expect(client.certCalls).toBe(callsAfter);
  });

  it('keeps serving and retries after a failed renewal', async () => {
    const soon = await makeCert(10);
    const fresh = await makeCert(90);
    let fail = true;
    const client = stubClient({ certs: () => (fail ? Promise.reject(new TailscaleError('unreachable', 'down')) : Promise.resolve(fresh)) });
    const applied: string[] = [];
    const handle = startCertRenewal({ client, domains: [], current: { ...soon, domain: NAME, notAfter: certNotAfter(soon.cert) }, apply: (p) => applied.push(p.cert), checkMs: 20, windowMs: 30 * 86_400_000 });
    cleanup.push(() => handle.stop());
    await vi_waitFor(() => client.certCalls >= 2);
    expect(applied).toEqual([]);
    fail = false;
    await vi_waitFor(() => applied.length === 1);
    expect(applied[0]).toBe(fresh.cert);
  });
});

async function vi_waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not reached');
    await new Promise((r) => { setTimeout(r, 10); });
  }
}

function peer(url: string): Promise<{ fingerprint: string; socket: TLSSocket }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: u.hostname, port: Number(u.port), rejectUnauthorized: false }, () => {
      resolve({ fingerprint: socket.getPeerCertificate().fingerprint256, socket });
    });
    socket.once('error', reject);
  });
}

async function bootDaemon(tailscale: NonNullable<Parameters<typeof startDaemon>[0]>['tailscale']): Promise<DaemonHandle> {
  const configDir = tmp();
  workspaceLoader.writeDaemonConfig({
    ...workspaceLoader.readDaemonConfig(configDir),
    http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'tailscale', domains: [] } },
    auth: { ...workspaceLoader.readDaemonConfig(configDir).auth, loopbackTrusted: true },
  }, configDir);
  const d = await startDaemon({ configDir, tailscale });
  cleanup.push(() => d.stop('test'));
  return d;
}

describe('tailscale mode in the daemon', () => {
  it('serves the certificate the Tailscale client returns', async () => {
    const good = await makeCert(90);
    const d = await bootDaemon({ client: stubClient({ certs: () => Promise.resolve(good) }), renewCheckMs: 3_600_000 });
    const { fingerprint, socket } = await peer(d.publicUrl);
    socket.destroy();
    const { X509Certificate } = await import('node:crypto');
    expect(fingerprint).toBe(new X509Certificate(good.cert).fingerprint256);
  }, 30_000);

  it('swaps the certificate on renewal without closing the listener or an open stream', async () => {
    const first = await makeCert(10);
    const second = await makeCert(90);
    let issued = 0;
    const client = stubClient({ certs: () => Promise.resolve(issued++ === 0 ? first : second) });
    const d = await bootDaemon({ client, renewCheckMs: 50, renewWindowMs: 30 * 86_400_000 });
    // The first fetch is the start-up one; renewal only fires for a certificate inside the window (10 days).
    const { X509Certificate } = await import('node:crypto');
    const fp = (c: string): string => new X509Certificate(c).fingerprint256;

    // An open connection, held across the swap.
    const held = await peer(d.publicUrl);
    expect(held.fingerprint).toBe(fp(first.cert));
    let heldClosed = false;
    held.socket.on('close', () => { heldClosed = true; });

    const port = new URL(d.publicUrl).port;
    await vi_waitFor(() => issued >= 2);
    let after = await peer(d.publicUrl);
    for (let i = 0; i < 100 && after.fingerprint !== fp(second.cert); i += 1) {
      after.socket.destroy();
      await new Promise((r) => { setTimeout(r, 20); });
      after = await peer(d.publicUrl);
    }
    expect(after.fingerprint).toBe(fp(second.cert));
    expect(new URL(d.publicUrl).port).toBe(port);
    after.socket.destroy();
    expect(heldClosed).toBe(false);
    held.socket.destroy();
  }, 30_000);

  it('fails start with the not-running message after the wait, opening no listener', async () => {
    const client = stubClient({ status: () => Promise.reject(new TailscaleError('unreachable', 'Tailscale is not running (cannot reach /x)')), certs: () => Promise.reject(new Error('unused')) });
    const configDir = tmp();
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'tailscale', domains: [] } }, auth: { ...workspaceLoader.readDaemonConfig(configDir).auth, loopbackTrusted: true } }, configDir);
    await expect(startDaemon({ configDir, tailscale: { client, waitMs: 120, retryMs: 20 } })).rejects.toThrow(/Tailscale is not running/);
    expect(client.statusCalls).toBeGreaterThan(2);
  }, 30_000);

  it('starts when tailscale comes up after a few attempts', async () => {
    const good = await makeCert(90);
    let n = 0;
    const client = stubClient({ status: () => (++n < 4 ? Promise.reject(new TailscaleError('unreachable', 'Tailscale is not running')) : Promise.resolve(RUNNING)), certs: () => Promise.resolve(good) });
    const d = await bootDaemon({ client, waitMs: 5_000, retryMs: 10, renewCheckMs: 3_600_000 });
    const { socket } = await peer(d.publicUrl);
    socket.destroy();
    expect(n).toBe(4);
  }, 30_000);

  it('does not start on the acme mode, and the error points at tailscale and files', async () => {
    const configDir = tmp();
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'acme', domains: [] } }, auth: { ...workspaceLoader.readDaemonConfig(configDir).auth, loopbackTrusted: true } }, configDir);
    await expect(startDaemon({ configDir })).rejects.toThrow(/tailscale.*files/);
  }, 30_000);
});
