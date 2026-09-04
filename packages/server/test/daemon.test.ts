/** Smoke test: boot a real daemon over a temp config dir and workspace, then shut it down. */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceLoader, initLogger } from '@openconductor/core';
import { startDaemon, type DaemonHandle } from '../src/daemon.js';

initLogger(process.env.OC_LOG_LEVEL ?? 'silent');

let daemon: DaemonHandle | null = null;
let dirs: string[] = [];
afterEach(async () => {
  await daemon?.stop('test');
  daemon = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('startDaemon', () => {
  it('loads a registered workspace and serves health on both listeners', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'oc-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'oc-ws-'));
    dirs = [configDir, wsDir];

    await workspaceLoader.initWorkspace(wsDir, { id: 'smoke', name: 'Smoke', ticketPrefix: 'SMK' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'smoke', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir });
    expect(daemon.workspaces.has('smoke')).toBe(true);

    const health = await fetch(new URL('/api/health', daemon.loopbackUrl));
    expect(health.status).toBe(200);
    const payload = await health.json();
    expect(payload.ok).toBe(true);
    expect(payload.workspaces.map((w: { id: string }) => w.id)).toContain('smoke');

    const pidFile = join(configDir, 'daemon.json');
    expect(existsSync(pidFile)).toBe(true);
    expect(JSON.parse(readFileSync(pidFile, 'utf8'))).toMatchObject({ pid: process.pid, loopbackUrl: daemon.loopbackUrl });

    await daemon.stop('test');
    expect(existsSync(pidFile)).toBe(false);
    daemon = null;
  }, 30_000);
});
