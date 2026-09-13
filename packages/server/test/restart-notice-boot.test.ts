/**
 * The boot wiring for the restart notice (VS-339): a real daemon, two boots in one config directory,
 * and the durable lifecycle that decides whether the second boot announces a restart or suppresses it
 * as an upgrade. No systemd unit is involved — the daemon is started and stopped directly.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceLoader, initLogger } from '@weave-ai/core';
import { openDb } from '@weave-ai/db';
import { startDaemon, type DaemonHandle } from '../src/daemon.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

let daemon: DaemonHandle | null = null;
let dirs: string[] = [];
afterEach(async () => {
  await daemon?.stop('test');
  daemon = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was never reached');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function configDirFor(id: string): Promise<string> {
  const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
  const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
  dirs = [configDir, wsDir];
  await workspaceLoader.initWorkspace(wsDir, { id, name: id, ticketPrefix: 'RST' });
  workspaceLoader.writeRegistry({ workspaces: [{ id, path: wsDir }] }, configDir);
  workspaceLoader.writeDaemonConfig({
    ...workspaceLoader.readDaemonConfig(configDir),
    http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } },
  }, configDir);
  return configDir;
}

const restartedWake = (handle: DaemonHandle, id: string) => handle.workspaces.get(id)!.ctx.db
  .get<{ reason: string }>("SELECT reason FROM wakeups WHERE reason LIKE 'The daemon restarted%'");

describe('the restart notice at boot (VS-339)', () => {
  it('a same-release restart wakes each weaver and posts the chat line', async () => {
    const configDir = await configDirFor('restart');
    daemon = await startDaemon({ configDir });
    await daemon.stop('test');
    daemon = null;

    daemon = await startDaemon({ configDir });
    const ctx = daemon.workspaces.get('restart')!.ctx;
    await until(() => restartedWake(daemon!, 'restart') !== undefined);

    expect(restartedWake(daemon, 'restart')!.reason).toMatch(/^The daemon restarted and is back up at /);
    await until(() => ctx.db.get("SELECT id FROM thread_messages WHERE body LIKE 'Back up at%'") !== undefined);
  }, 20_000);

  it('a boot on a different release is an upgrade and posts no restart notice', async () => {
    const configDir = await configDirFor('upgrade');
    daemon = await startDaemon({ configDir });
    await daemon.stop('test');
    daemon = null;

    // Simulate the previous boot having run another release, which is how an upgrade restart looks.
    const configDb = openDb(join(configDir, 'daemon.sqlite'));
    configDb.run("INSERT INTO meta (key, value) VALUES ('daemon.lifecycle.boot_release', '/rel/other-release') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    configDb.close();

    daemon = await startDaemon({ configDir });
    // Give the (suppressed) announcement a chance to run; it must not.
    await new Promise((r) => setTimeout(r, 150));
    expect(restartedWake(daemon, 'upgrade')).toBeUndefined();
  }, 20_000);
});
