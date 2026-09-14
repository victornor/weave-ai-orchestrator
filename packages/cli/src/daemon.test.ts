/**
 * VS-262: `renderServiceUnit`'s `TimeoutStopSec` tracks `SHUTDOWN_KILL_GRACE_MS`, and `stopDaemon`
 * actually waits its given timeout before escalating to `SIGKILL` rather than a hardcoded short one.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_KILL_GRACE_MS } from '@weave-ai/shared';
import { SERVICE_NAME } from '@weave-ai/release';
import {
  ensureUnitRestartAlways, isRunning, pidFile, renderServiceUnit, startDaemonService, stopDaemon, stopDaemonService,
  systemdMainPid, withRestartAlways, type CommandResult, type RunCommand,
} from './daemon.js';

describe('renderServiceUnit (VS-262, VS-376)', () => {
  it("TimeoutStopSec tracks SHUTDOWN_KILL_GRACE_MS, not an independent hardcoded number", () => {
    const unit = renderServiceUnit('/bin/node');
    expect(unit).toContain(`TimeoutStopSec=${Math.ceil(SHUTDOWN_KILL_GRACE_MS / 1000)}`);
  });

  it('restarts on any exit, not only on failure (VS-376)', () => {
    const unit = renderServiceUnit('/bin/node');
    expect(unit).toContain('Restart=always');
    expect(unit).not.toContain('Restart=on-failure');
    expect(unit).toContain('RestartSec=3');
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

// ---------- VS-376: the installed unit's restart policy and the systemd start/stop path ----------

describe('unit restart policy and systemd lifecycle (VS-376)', () => {
  const tmps: string[] = [];
  const savedConfigHome = process.env['XDG_CONFIG_HOME'];

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'ac-unit-'));
    tmps.push(base);
    process.env['XDG_CONFIG_HOME'] = base;
  });

  afterEach(() => {
    while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
    if (savedConfigHome === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = savedConfigHome;
  });

  function installUnit(content: string, name = SERVICE_NAME): string {
    const dir = join(process.env['XDG_CONFIG_HOME']!, 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  const noop = (over: Partial<CommandResult> = {}): CommandResult => ({ status: 0, signal: null, stdout: '', stderr: '', ...over });
  const fake = (over: Partial<CommandResult> = {}): { run: RunCommand; calls: string[][] } => {
    const calls: string[][] = [];
    const run: RunCommand = (cmd, args) => { calls.push([cmd, ...args]); return noop(over); };
    return { run, calls };
  };

  it('withRestartAlways replaces an on-failure line, and is a no-op at always or with no Restart line', () => {
    expect(withRestartAlways('[Service]\nRestart=on-failure\n')).toBe('[Service]\nRestart=always\n');
    expect(withRestartAlways('[Service]\nRestart=always\n')).toBe('[Service]\nRestart=always\n');
    expect(withRestartAlways('[Service]\nExecStart=/x\n')).toBe('[Service]\nExecStart=/x\n');
  });

  it('rewrites an installed on-failure unit and reloads systemd', () => {
    const path = installUnit('[Unit]\nDescription=Weave AI daemon\n\n[Service]\nRestart=on-failure\nRestartSec=3\n');
    const { run, calls } = fake();
    const result = ensureUnitRestartAlways(run);
    expect(result).toEqual({ unit: SERVICE_NAME, path, changed: true });
    expect(readFileSync(path, 'utf8')).toContain('Restart=always');
    expect(calls).toEqual([['systemctl', '--user', 'daemon-reload']]);
  });

  it('leaves an always unit alone, with no reload', () => {
    const path = installUnit('[Service]\nRestart=always\n');
    const { run, calls } = fake();
    expect(ensureUnitRestartAlways(run)).toEqual({ unit: SERVICE_NAME, path, changed: false });
    expect(calls).toEqual([]);
  });

  it('is a no-op with no unit installed', () => {
    const { run } = fake();
    expect(ensureUnitRestartAlways(run)).toBeNull();
  });

  it('startDaemonService starts the installed unit through systemctl, and is null with no unit', () => {
    installUnit('[Service]\nRestart=always\n');
    const { run, calls } = fake();
    expect(startDaemonService(run)).toEqual({ unit: SERVICE_NAME, how: `systemctl --user start ${SERVICE_NAME}` });
    expect(calls).toEqual([['systemctl', '--user', 'start', SERVICE_NAME]]);

    rmSync(join(process.env['XDG_CONFIG_HOME']!, 'systemd'), { recursive: true, force: true });
    expect(startDaemonService(run)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('stopDaemonService stops the installed unit, and is null with no unit', () => {
    installUnit('[Service]\nRestart=always\n');
    const { run, calls } = fake();
    expect(stopDaemonService(run)).toEqual({ unit: SERVICE_NAME, how: `systemctl --user stop ${SERVICE_NAME}` });
    expect(calls).toEqual([['systemctl', '--user', 'stop', SERVICE_NAME]]);

    rmSync(join(process.env['XDG_CONFIG_HOME']!, 'systemd'), { recursive: true, force: true });
    expect(stopDaemonService(run)).toBeNull();
  });

  it('surfaces a start failure with its stderr rather than reporting success', () => {
    installUnit('[Service]\nRestart=always\n');
    const run: RunCommand = () => noop({ status: 5, stderr: 'Unit not found.\n' });
    expect(() => startDaemonService(run)).toThrow(/Unit not found/);
  });

  it('systemdMainPid reads the unit it is given, and null when the show call fails', () => {
    installUnit('[Service]\nRestart=always\n');
    const unit = { name: SERVICE_NAME, path: join(process.env['XDG_CONFIG_HOME']!, 'systemd', 'user', SERVICE_NAME), legacy: false };
    const ok: RunCommand = (_cmd, args) => noop({ stdout: args.includes('show') ? '4242\n' : '' });
    expect(systemdMainPid(unit, ok)).toBe(4242);
    expect(systemdMainPid(unit, () => noop({ status: 1 }))).toBeNull();
  });
});
