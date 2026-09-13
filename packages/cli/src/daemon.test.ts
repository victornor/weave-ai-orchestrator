/**
 * VS-262: `renderServiceUnit`'s `TimeoutStopSec` tracks `SHUTDOWN_KILL_GRACE_MS`, and `stopDaemon`
 * actually waits its given timeout before escalating to `SIGKILL` rather than a hardcoded short one.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_KILL_GRACE_MS } from '@weave-ai/shared';
import { isRunning, pidFile, renderServiceUnit, stopDaemon } from './daemon.js';

describe('renderServiceUnit (VS-262)', () => {
  it("TimeoutStopSec tracks SHUTDOWN_KILL_GRACE_MS, not an independent hardcoded number", () => {
    const unit = renderServiceUnit('/bin/node');
    expect(unit).toContain(`TimeoutStopSec=${Math.ceil(SHUTDOWN_KILL_GRACE_MS / 1000)}`);
  });
});

describe('stopDaemon (VS-262)', () => {
  let stateDir: string;
  const savedStateHome = process.env['XDG_STATE_HOME'];

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'ac-stop-'));
    process.env['XDG_STATE_HOME'] = stateDir;
  });

  afterEach(() => {
    if (savedStateHome === undefined) delete process.env['XDG_STATE_HOME'];
    else process.env['XDG_STATE_HOME'] = savedStateHome;
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('condition was never reached');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /**
   * A stand-in for the daemon process: registers a `SIGTERM` trap, signals `ready` once that
   * registration has actually happened (spawning is async — sending `SIGTERM` before the handler is
   * registered would kill it via the default action, not the trap this test means to exercise), then
   * on `SIGTERM` waits `ignoreForMs` and writes `marker` before exiting 0. `SIGKILL` cannot be
   * trapped, so if the process dies before writing `marker`, it was killed rather than having exited
   * on its own — the one fact these tests need to observe.
   */
  async function spawnStandIn(ignoreForMs: number, marker: string): Promise<number> {
    const ready = join(stateDir, 'ready');
    const script = `
      process.on('SIGTERM', () => {
        setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'exited-gracefully'); process.exit(0); }, ${ignoreForMs});
      });
      require('fs').writeFileSync(${JSON.stringify(ready)}, 'ready');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
    child.unref();
    mkdirSync(dirname(pidFile()), { recursive: true });
    writeFileSync(pidFile(), String(child.pid));
    await until(() => existsSync(ready));
    return child.pid!;
  }

  it('does not SIGKILL a process that exits gracefully within the given timeout', async () => {
    const marker = join(stateDir, 'marker-a');
    const pid = await spawnStandIn(50, marker);

    const started = Date.now();
    const result = await stopDaemon(2000);
    expect(result.stopped).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(existsSync(marker)).toBe(true);
    expect(isRunning(pid)).toBe(false);
  });

  it('sends SIGKILL once the given timeout elapses with the process still running', async () => {
    const marker = join(stateDir, 'marker-b');
    const pid = await spawnStandIn(3000, marker);

    const started = Date.now();
    const result = await stopDaemon(150);
    expect(result.stopped).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    // Killed before it ever reached its own graceful-exit path. `stopDaemon` does not itself wait to
    // confirm the kill landed, so give the OS a moment before checking.
    expect(existsSync(marker)).toBe(false);
    await until(() => !isRunning(pid));
  });

  it('throws if the process is still running after SIGKILL (VS-316)', async () => {
    mkdirSync(dirname(pidFile()), { recursive: true });
    writeFileSync(pidFile(), '999999');
    // Every `process.kill` call — the SIGTERM, the probing 0-signal, and the SIGKILL — "succeeds" and
    // never throws ESRCH, so `isRunning` reports true forever, simulating a kill that did not land.
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      await expect(stopDaemon(10)).rejects.toThrow(/still running/);
    } finally {
      killSpy.mockRestore();
    }
  });
});
