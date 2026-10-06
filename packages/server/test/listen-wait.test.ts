/** VS-783: the public listener waits a bounded time for a not-yet-assigned address (`EADDRNOTAVAIL`). */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceLoader, initLogger } from '@weave-ai/core';
import { nowIso, openDb } from '@weave-ai/db';
import { listenWithWait, startDaemon, type DaemonHandle } from '../src/daemon.js';
import { observeBoot } from '../src/restart-notice.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

const errno = (code: string) => Object.assign(new Error(`listen ${code} 192.0.2.1:0`), { code });
/** TEST-NET-1 (RFC 5737) is never assigned to an interface, so binding it really fails EADDRNOTAVAIL. */
const UNASSIGNED = '192.0.2.1';

describe('listenWithWait', () => {
  it('retries EADDRNOTAVAIL until the bind succeeds', async () => {
    const attempts: number[] = [];
    await listenWithWait(async (n) => { attempts.push(n); if (n < 3) throw errno('EADDRNOTAVAIL'); }, { host: 'h', timeoutMs: 2000, initialDelayMs: 1, maxDelayMs: 2 });
    expect(attempts).toEqual([0, 1, 2, 3]);
  });

  it('rethrows the last EADDRNOTAVAIL after the bound', async () => {
    const err = errno('EADDRNOTAVAIL');
    let calls = 0;
    const started = Date.now();
    await expect(listenWithWait(async () => { calls++; throw err; }, { host: 'h', timeoutMs: 60, initialDelayMs: 5, maxDelayMs: 10 })).rejects.toBe(err);
    expect(calls).toBeGreaterThan(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it.each(['EADDRINUSE', 'EACCES'])('fails at once on %s', async (code) => {
    let calls = 0;
    await expect(listenWithWait(async () => { calls++; throw errno(code); }, { host: 'h', timeoutMs: 5000, initialDelayMs: 1 })).rejects.toMatchObject({ code });
    expect(calls).toBe(1);
  });
});

describe('daemon start', () => {
  let daemon: DaemonHandle | null = null;
  let blocker: Server | null = null;
  let dirs: string[] = [];
  afterEach(async () => {
    await daemon?.stop('test');
    daemon = null;
    await new Promise<void>((res) => (blocker ? blocker.close(() => res()) : res()));
    blocker = null;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  async function configure(listen: string): Promise<string> {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs.push(configDir, wsDir);
    await workspaceLoader.initWorkspace(wsDir, { id: 'lw', name: 'LW', ticketPrefix: 'LW' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'lw', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen, trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);
    return configDir;
  }
  const failedStarts = (configDir: string) => {
    const db = openDb(join(configDir, 'daemon.sqlite'));
    try { return observeBoot(db, { now: nowIso(), release: null, pid: null }).failedStarts; } finally { db.close(); }
  };

  it('starts once, with no failed-start record, when the address appears after a delay', async () => {
    const configDir = await configure('127.0.0.1:0');
    const hosts: string[] = [];
    daemon = await startDaemon({
      configDir,
      listenWait: { timeoutMs: 5000, initialDelayMs: 5, maxDelayMs: 10, hostForAttempt: (n) => { const h = n < 3 ? UNASSIGNED : '127.0.0.1'; hosts.push(h); return h; } },
    });
    expect(hosts).toEqual([UNASSIGNED, UNASSIGNED, UNASSIGNED, '127.0.0.1']);
    expect((await fetch(new URL('/api/health', daemon.publicUrl))).status).toBe(200);
    await daemon.stop('test');
    daemon = null;
    expect(failedStarts(configDir).count).toBe(0);
  }, 30_000);

  it('fails with EADDRNOTAVAIL after the bound when the address never appears, and records the failed start', async () => {
    const configDir = await configure('127.0.0.1:0');
    await expect(startDaemon({
      configDir, listenWait: { timeoutMs: 100, initialDelayMs: 10, maxDelayMs: 20, hostForAttempt: () => UNASSIGNED },
    })).rejects.toMatchObject({ code: 'EADDRNOTAVAIL' });
    expect(failedStarts(configDir).count).toBe(1);
  }, 30_000);

  it('fails fast on EADDRINUSE', async () => {
    blocker = createServer();
    await new Promise<void>((res) => blocker!.listen(0, '127.0.0.1', () => res()));
    const port = (blocker.address() as AddressInfo).port;
    const configDir = await configure(`127.0.0.1:${port}`);
    const started = Date.now();
    await expect(startDaemon({ configDir, listenWait: { timeoutMs: 20_000, initialDelayMs: 1000 } })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(failedStarts(configDir).count).toBe(1);
  }, 30_000);
});
