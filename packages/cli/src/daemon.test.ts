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
import { SERVICE_NAME, CONDUCTOR_DEPRECATION, cliShimTarget, dataHome, readCliShimTarget, userBinDir } from '@weave-ai/release';
import {
  assessListenConflict, ensureUnitRestartAlways, installService, isRunning, localDaemonCheck, onTargetRelease,
  pidFile, preflightRestart, reconcileDetachedDaemon, renderServiceUnit, restartSafetyChecks, startDaemonService,
  stopDaemon, stopDaemonService, systemdMainPid, verifyRestart, withManagedOOMPreference, withRestartAlways, type CommandResult, type RunCommand,
} from './daemon.js';

// VS-388: record any real `spawnSync` so a test can prove the guard refused before it could run.
// `spawn` stays the real one — the `stopDaemon` cases below need it for their stand-in processes.
const childProcess = vi.hoisted(() => ({ spawnSyncCalls: [] as unknown[][] }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => {
      childProcess.spawnSyncCalls.push(args);
      return { status: 0, signal: null, stdout: '', stderr: '' };
    },
  };
});

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

  it('marks the daemon unit avoid for systemd-oomd (VS-579)', () => {
    expect(renderServiceUnit('/bin/node')).toContain('ManagedOOMPreference=avoid');
  });
});

describe('withManagedOOMPreference (VS-579)', () => {
  it('adds the line under [Service] when absent', () => {
    const next = withManagedOOMPreference('[Service]\nRestart=always\n');
    expect(next).toContain('ManagedOOMPreference=avoid');
  });

  it('leaves an existing correct value untouched and corrects a wrong one', () => {
    expect(withManagedOOMPreference('[Service]\nManagedOOMPreference=avoid\n')).toBe('[Service]\nManagedOOMPreference=avoid\n');
    expect(withManagedOOMPreference('[Service]\nManagedOOMPreference=none\n')).toBe('[Service]\nManagedOOMPreference=avoid\n');
  });

  it('does nothing without a [Service] section', () => {
    expect(withManagedOOMPreference('[Unit]\nDescription=x\n')).toBe('[Unit]\nDescription=x\n');
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

  it('adds the oomd avoid line to an installed unit that predates it (VS-579)', () => {
    const path = installUnit('[Service]\nRestart=always\n');
    const { run, calls } = fake();
    expect(ensureUnitRestartAlways(run)).toEqual({ unit: SERVICE_NAME, path, changed: true });
    expect(readFileSync(path, 'utf8')).toContain('ManagedOOMPreference=avoid');
    expect(calls).toEqual([['systemctl', '--user', 'daemon-reload']]);
  });

  it('leaves a unit carrying both guards alone, with no reload', () => {
    const path = installUnit('[Service]\nRestart=always\nManagedOOMPreference=avoid\n');
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

  it('refuses to spawn the host systemctl from the default runner instead of stopping the live unit (VS-388)', () => {
    // A unit is installed, so `stopDaemonService()` would otherwise run a real `systemctl --user stop`
    // against whatever `resolveInstalledUnit()` found. Under the suite's guard it must throw first.
    installUnit('[Service]\nRestart=always\n');
    childProcess.spawnSyncCalls.length = 0;
    expect(() => stopDaemonService()).toThrow(/refusing to run `systemctl`/);
    expect(childProcess.spawnSyncCalls).toEqual([]);
    expect(() => startDaemonService()).toThrow(/refusing to run `systemctl`/);
    expect(childProcess.spawnSyncCalls).toEqual([]);
  });
});

/**
 * VS-377: `weave daemon install-service` is the install moment, so it puts `weave` on PATH — pointing
 * at the current release's CLI — and rewrites an existing deprecated `conductor` shim. Everything runs
 * in a temp HOME / XDG pair; the real `~/.local/bin`, release dirs and unit are never touched.
 */
describe('installService writes the CLI shim (VS-377)', () => {
  const saved = { HOME: process.env['HOME'], XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'], XDG_DATA_HOME: process.env['XDG_DATA_HOME'] };
  let home: string;
  let configHomeDir: string;
  let dataHomeDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'vs377-home-'));
    configHomeDir = mkdtempSync(join(tmpdir(), 'vs377-config-'));
    dataHomeDir = mkdtempSync(join(tmpdir(), 'vs377-data-'));
    process.env['HOME'] = home;
    process.env['XDG_CONFIG_HOME'] = configHomeDir;
    process.env['XDG_DATA_HOME'] = dataHomeDir;
    // A release install: `weave/current` with both bins, so resolveServerBin and the shim target resolve.
    for (const pkg of ['server', 'cli']) {
      const bin = join(dataHomeDir, 'weave', 'current', 'packages', pkg, 'dist', 'bin.js');
      mkdirSync(dirname(bin), { recursive: true });
      writeFileSync(bin, '// bin\n');
    }
  });

  afterEach(() => {
    for (const k of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'] as const) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    for (const dir of [home, configHomeDir, dataHomeDir]) rmSync(dir, { recursive: true, force: true });
  });

  it('writes an executable weave shim at the current release, and no conductor on a fresh install', () => {
    const result = installService();
    const weave = join(userBinDir(home), 'weave');
    expect(result.shim).toMatchObject({ path: weave, present: true, changed: true, alias: null, reason: null });
    expect(readCliShimTarget(readFileSync(weave, 'utf8'))).toBe(cliShimTarget(dataHome()));
    expect(readFileSync(weave, 'utf8')).toContain('Weave AI CLI');
    expect(existsSync(join(userBinDir(home), 'conductor'))).toBe(false);
  });

  it('rewrites an existing conductor shim with the deprecation notice', () => {
    const conductor = join(userBinDir(home), 'conductor');
    mkdirSync(userBinDir(home), { recursive: true });
    writeFileSync(conductor, `#!/bin/sh\nexec "/usr/bin/node" "${cliShimTarget(dataHome())}" "$@"\n`);

    const result = installService();
    expect(result.shim?.alias).toBe(conductor);
    const content = readFileSync(conductor, 'utf8');
    expect(readCliShimTarget(content)).toBe(cliShimTarget(dataHome()));
    expect(content).toContain(CONDUCTOR_DEPRECATION);
  });
});

// ---------- VS-407: detached-daemon handover and restart verification ----------

describe('VS-407 detached-daemon reconciliation and postflight', () => {
  const unit = { name: SERVICE_NAME, path: `/x/${SERVICE_NAME}`, legacy: false };
  const tmps: string[] = [];
  const saved = { XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'], XDG_STATE_HOME: process.env['XDG_STATE_HOME'] };

  beforeEach(() => {
    process.env['XDG_CONFIG_HOME'] = mkdtempSync(join(tmpdir(), 'vs407-config-'));
    process.env['XDG_STATE_HOME'] = mkdtempSync(join(tmpdir(), 'vs407-state-'));
    tmps.push(process.env['XDG_CONFIG_HOME']!, process.env['XDG_STATE_HOME']!);
  });
  afterEach(() => {
    while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
    for (const k of ['XDG_CONFIG_HOME', 'XDG_STATE_HOME'] as const) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  /** A runner whose `ss` answer changes once `holding` flips — the detached process letting go. */
  function hostRun(state: { holding: boolean; mainPid: number | null }): RunCommand {
    return (cmd, args) => {
      if (cmd === 'systemctl') {
        const valueOnly = args.includes('--value');
        return { status: 0, signal: null, stdout: valueOnly ? `${state.mainPid ?? 0}\n` : `MainPID=${state.mainPid ?? 0}\n`, stderr: '' };
      }
      if (cmd === 'ss') {
        return { status: 0, signal: null, stdout: state.holding ? `LISTEN 0 1 0.0.0.0:7433 0.0.0.0:* users:(("node",pid=4242,fd=1))\n` : '', stderr: '' };
      }
      return { status: 0, signal: null, stdout: '', stderr: '' };
    };
  }

  it('SIGTERMs the verified detached daemon, waits for the address to free, and drops the pid file', async () => {
    const state = { holding: true, mainPid: 999 };
    const run = hostRun(state);
    const signals: Array<[number, NodeJS.Signals]> = [];
    const alive = { v: true };
    const result = await reconcileDetachedDaemon({
      run, unit, port: 7433, pid: 4242,
      cmdline: () => '/x/weave/releases/1/packages/server/dist/bin.js\0',
      alive: () => alive.v,
      signal: (pid, sig) => { signals.push([pid, sig]); alive.v = false; state.holding = false; },
      sleep: async () => undefined,
      now: (() => { let t = 0; return () => (t += 1000); })(),
    });
    expect(result.reconciled).toBe(true);
    expect(signals).toEqual([[4242, 'SIGTERM']]);
    expect(existsSync(pidFile())).toBe(false);
  });

  it('never signals a pid that is not this product, even if a pid file names it', async () => {
    const signals: number[] = [];
    const result = await reconcileDetachedDaemon({
      run: hostRun({ holding: true, mainPid: 999 }), unit, port: 7433, pid: 4242,
      cmdline: () => 'node\0/app/other.js\0', alive: () => true,
      signal: (pid) => signals.push(pid), sleep: async () => undefined, now: () => 0,
    });
    expect(result.reconciled).toBe(false);
    expect(result.reason).toMatch(/not this product/);
    expect(signals).toEqual([]);
  });

  it('never signals the unit\'s own main pid', async () => {
    const signals: number[] = [];
    const result = await reconcileDetachedDaemon({
      run: hostRun({ holding: true, mainPid: 4242 }), unit, port: 7433, pid: 4242,
      cmdline: () => '/x/packages/server/dist/bin.js\0', alive: () => true,
      signal: (pid) => signals.push(pid), sleep: async () => undefined, now: () => 0,
    });
    expect(result.reconciled).toBe(false);
    expect(signals).toEqual([]);
  });

  it('never signals a tracked pid that no longer holds the listen address', async () => {
    const signals: number[] = [];
    const result = await reconcileDetachedDaemon({
      run: hostRun({ holding: false, mainPid: 999 }), unit, port: 7433, pid: 4242,
      cmdline: () => '/x/packages/server/dist/bin.js\0', alive: () => true,
      signal: (pid) => signals.push(pid), sleep: async () => undefined, now: () => 0,
    });
    expect(result.reconciled).toBe(false);
    expect(result.reason).toMatch(/does not hold/);
    expect(signals).toEqual([]);
  });

  it('refuses when the unit\'s state cannot be read, and never signals (VS-407)', async () => {
    const signals: number[] = [];
    const result = await reconcileDetachedDaemon({
      run: (cmd) => (cmd === 'ss'
        ? { status: 0, signal: null, stdout: 'LISTEN 0 1 0.0.0.0:7433 0.0.0.0:* users:(("node",pid=4242,fd=1))\n', stderr: '' }
        : { status: 0, signal: null, stdout: '', stderr: '' }), // systemctl answers nothing: no ActiveState, no MainPID
      unit, port: 7433, pid: 4242,
      cmdline: () => '/x/packages/server/dist/bin.js\0', alive: () => true,
      signal: (pid) => signals.push(pid), sleep: async () => undefined, now: () => 0,
    });
    expect(result.reconciled).toBe(false);
    expect(result.reason).toMatch(/could not be read/);
    expect(signals).toEqual([]);
  });

  it('refuses a pid the unit owns through its cgroup, and never signals (VS-407)', async () => {
    const signals: number[] = [];
    const result = await reconcileDetachedDaemon({
      run: hostRun({ holding: true, mainPid: 999 }), unit, port: 7433, pid: 4242,
      cmdline: () => '/x/packages/server/dist/bin.js\0', alive: () => true,
      readCgroup: () => `0::/user.slice/user@1000.service/app.slice/${SERVICE_NAME}\n`,
      signal: (pid) => signals.push(pid), sleep: async () => undefined, now: () => 0,
    });
    expect(result.reconciled).toBe(false);
    expect(result.reason).toMatch(/belongs to/);
    expect(signals).toEqual([]);
  });

  it('refuses when there is no MainPID and the cgroup cannot be read, and never signals (VS-407)', async () => {
    const signals: number[] = [];
    const result = await reconcileDetachedDaemon({
      run: (cmd) => (cmd === 'systemctl'
        ? { status: 0, signal: null, stdout: 'ActiveState=inactive\nSubState=dead\nNRestarts=0\nMainPID=0\n', stderr: '' }
        : { status: 0, signal: null, stdout: 'LISTEN 0 1 0.0.0.0:7433 0.0.0.0:* users:(("node",pid=4242,fd=1))\n', stderr: '' }),
      unit, port: 7433, pid: 4242,
      cmdline: () => '/x/packages/server/dist/bin.js\0', alive: () => true,
      readCgroup: () => { throw new Error('no /proc'); },
      signal: (pid) => signals.push(pid), sleep: async () => undefined, now: () => 0,
    });
    expect(result.reconciled).toBe(false);
    expect(result.reason).toMatch(/cgroup cannot be read/);
    expect(signals).toEqual([]);
  });

  /** `MainPID=0` with a readable state is handover's whole reason to exist: run it against both shapes. */
  async function handoverWithUnitState(stateLine: string): Promise<{ reconciled: boolean; signals: Array<[number, NodeJS.Signals]> }> {
    const signals: Array<[number, NodeJS.Signals]> = [];
    const alive = { v: true };
    const holding = { v: true };
    const result = await reconcileDetachedDaemon({
      run: (cmd) => {
        if (cmd === 'systemctl') return { status: 0, signal: null, stdout: stateLine, stderr: '' };
        if (cmd === 'ss') return { status: 0, signal: null, stdout: holding.v ? 'LISTEN 0 1 0.0.0.0:7433 0.0.0.0:* users:(("node",pid=4242,fd=1))\n' : '', stderr: '' };
        return { status: 0, signal: null, stdout: '', stderr: '' };
      },
      unit, port: 7433, pid: 4242,
      cmdline: () => '/x/packages/server/dist/bin.js\0', alive: () => alive.v,
      readCgroup: () => '0::/user.slice/user-1000.slice/session-1.scope\n', // a user session, not the unit
      signal: (pid, sig) => { signals.push([pid, sig]); alive.v = false; holding.v = false; },
      sleep: async () => undefined, now: () => 0,
    });
    return { reconciled: result.reconciled, signals };
  }

  it('hands over during a crash loop (MainPID 0, activating) — the incident shape (VS-407)', async () => {
    const r = await handoverWithUnitState('ActiveState=activating\nSubState=auto-restart\nNRestarts=600\nMainPID=0\n');
    expect(r.reconciled).toBe(true);
    expect(r.signals).toEqual([[4242, 'SIGTERM']]);
  });

  it('hands over to a stopped unit (MainPID 0, inactive) (VS-407)', async () => {
    const r = await handoverWithUnitState('ActiveState=inactive\nSubState=dead\nNRestarts=0\nMainPID=0\n');
    expect(r.reconciled).toBe(true);
    expect(r.signals).toEqual([[4242, 'SIGTERM']]);
  });

  it('classifies who holds the address relative to the unit', () => {
    const run = hostRun({ holding: true, mainPid: 999 });
    expect(assessListenConflict({ run, unit, port: 7433, unitMainPid: 4242, trackedPids: [4242] }).kind).toBe('unit');
    expect(assessListenConflict({ run, unit, port: 7433, unitMainPid: 999, trackedPids: [4242] }).kind).toBe('detached');
    expect(assessListenConflict({ run, unit, port: 7433, unitMainPid: 999, trackedPids: [7] }).kind).toBe('other');
    expect(assessListenConflict({ run, unit: null, port: 7433, unitMainPid: null, trackedPids: [] }).kind).toBe('none');
  });

  it('refuses preflight with the holder named, and reports a handover', async () => {
    const refused = await preflightRestart({
      reconcile: async () => ({ reconciled: false, pid: null, reason: 'no live detached daemon is recorded' }),
      assess: () => ({ kind: 'other', pid: 7, command: 'node' }),
      unit,
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.message).toContain('pid 7');

    const handed = await preflightRestart({
      reconcile: async () => ({ reconciled: true, pid: 4242, reason: 'gracefully stopped the detached daemon pid 4242' }),
      assess: () => ({ kind: 'none', pid: null, command: null }),
      unit,
    });
    expect(handed).toEqual({ ok: true, handover: { reconciled: true, pid: 4242, reason: 'gracefully stopped the detached daemon pid 4242' } });
  });

  const clock = () => ({ t: 0, now() { return this.t; }, async sleep(ms: number) { this.t += ms; } });

  it('accepts a restart only when the unit is active and the target release is served', async () => {
    const v = await verifyRestart({
      unit, target: { release: '/rel/new', sha: 'a'.repeat(40) }, startedPid: null,
      readUnitState: () => ({ activeState: 'active', subState: 'running', nRestarts: 0, mainPid: 999 }),
      probe: async () => ({ ok: true, version: 'v2', releasePath: '/rel/new', releaseSha: 'a'.repeat(40), pid: 999 }),
      owned: () => true, now: () => 0, sleep: async () => undefined, timeoutMs: 1000,
    });
    expect(v).toEqual({ ok: true, version: 'v2' });
  });

  it('fails on a crash loop', async () => {
    const c = clock();
    let n = 0;
    const v = await verifyRestart({
      unit, target: { release: '/rel/new', sha: null }, startedPid: null,
      readUnitState: () => ({ activeState: 'activating', subState: 'auto-restart', nRestarts: (n += 1), mainPid: 999 }),
      probe: async () => null, owned: () => true, now: c.now.bind(c), sleep: c.sleep.bind(c), timeoutMs: 1500,
    });
    expect(v.ok).toBe(false);
    expect(v.ok ? '' : v.message).toContain('crash-looping');
  });

  it('fails when a different release answers', async () => {
    const c = clock();
    const v = await verifyRestart({
      unit, target: { release: '/rel/new', sha: 'a'.repeat(40) }, startedPid: null,
      readUnitState: () => ({ activeState: 'active', subState: 'running', nRestarts: 0, mainPid: 999 }),
      probe: async () => ({ ok: true, version: 'old', releasePath: '/rel/old', releaseSha: 'b'.repeat(40), pid: 999 }),
      owned: () => true, now: c.now.bind(c), sleep: c.sleep.bind(c), timeoutMs: 1000,
    });
    expect(v.ok).toBe(false);
    expect(v.ok ? '' : v.message).toContain('not the target release');
  });

  it('fails when an orphan outside the unit serves the target release (restart/rollback case)', async () => {
    const c = clock();
    const v = await verifyRestart({
      unit, target: { release: '/rel/new', sha: null }, startedPid: null,
      readUnitState: () => ({ activeState: 'active', subState: 'running', nRestarts: 0, mainPid: 999 }),
      probe: async () => ({ ok: true, version: 'v2', releasePath: '/rel/new', releaseSha: null, pid: 7 }),
      owned: () => false, now: c.now.bind(c), sleep: c.sleep.bind(c), timeoutMs: 1000,
    });
    expect(v.ok).toBe(false);
  });

  it('with no unit, accepts only the pid it started', async () => {
    const c = clock();
    const base = { unit: null, target: { release: '/rel/new', sha: null }, readUnitState: () => ({ activeState: null, subState: null, nRestarts: null, mainPid: null }) };
    const wrong = await verifyRestart({ ...base, startedPid: 11, probe: async () => ({ ok: true, version: 'v2', releasePath: '/rel/new', releaseSha: null, pid: 22 }), now: c.now.bind(c), sleep: c.sleep.bind(c), timeoutMs: 1000 });
    expect(wrong.ok).toBe(false);
    const right = await verifyRestart({ ...base, startedPid: 11, probe: async () => ({ ok: true, version: 'v2', releasePath: '/rel/new', releaseSha: null, pid: 11 }), now: () => 0, sleep: async () => undefined, timeoutMs: 1000 });
    expect(right).toEqual({ ok: true, version: 'v2' });
  });

  it('matches the target by release path or commit', () => {
    const target = { release: '/rel/new', sha: 'a'.repeat(40) };
    expect(onTargetRelease({ ok: true, version: null, releasePath: '/rel/new', releaseSha: null, pid: 1 }, target)).toBe(true);
    expect(onTargetRelease({ ok: true, version: null, releasePath: '/other', releaseSha: 'a'.repeat(40), pid: 1 }, target)).toBe(true);
    expect(onTargetRelease({ ok: true, version: null, releasePath: '/other', releaseSha: 'b'.repeat(40), pid: 1 }, target)).toBe(false);
  });
});

describe('VS-407 doctor host checks', () => {
  const unit = { name: SERVICE_NAME, path: `/x/${SERVICE_NAME}`, legacy: false };
  const active = { activeState: 'active', subState: 'running', nRestarts: 0, mainPid: 999 };
  /** ss reports pid 4242 (a detached daemon); systemd answers the requested unit state. */
  const run = (mainPid: number | null): RunCommand => (cmd, args) => {
    if (cmd === 'systemctl') {
      const valueOnly = args.includes('--value');
      return { status: 0, signal: null, stdout: valueOnly ? `${mainPid ?? 0}\n` : `MainPID=${mainPid ?? 0}\n`, stderr: '' };
    }
    if (cmd === 'ss') return { status: 0, signal: null, stdout: 'LISTEN 0 1 0.0.0.0:7433 0.0.0.0:* users:(("node",pid=4242,fd=1))\n', stderr: '' };
    return { status: 0, signal: null, stdout: '', stderr: '' };
  };

  it('reads a unit-managed daemon as healthy, not "not started from this machine"', () => {
    const check = localDaemonCheck({ unit, pid: null, alive: () => false, unitState: active, run: run(999), port: 7433 });
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('unit-managed');
  });

  it('warns about a detached daemon running alongside the unit', () => {
    const check = localDaemonCheck({ unit, pid: 4242, alive: () => true, unitState: active, run: run(999), port: 7433 });
    expect(check.ok).toBe(null);
    expect(check.detail).toContain('detached daemon pid 4242');
    expect(check.fix).toContain('weave daemon restart');
  });

  it('still reports a plain running local daemon when no unit is installed', () => {
    expect(localDaemonCheck({ unit: null, pid: 4242, alive: () => true }).detail).toContain('running (pid 4242)');
    expect(localDaemonCheck({ unit: null, pid: null, alive: () => false }).ok).toBe(null);
  });

  it('flags a restart-looping or failed unit', () => {
    const failed = restartSafetyChecks({ unit, run: run(999), port: 7433, unitState: { activeState: 'failed', subState: 'failed', nRestarts: 612, mainPid: 999 } });
    expect(failed.some((c) => c.name === 'systemd unit restart loop' && c.ok === false)).toBe(true);
    const warning = restartSafetyChecks({ unit, run: run(999), port: 7433, unitState: { ...active, nRestarts: 3 } });
    expect(warning.some((c) => c.name === 'systemd unit restarts' && c.ok === null)).toBe(true);
  });

  it('flags an out-of-service process on the listen address and stays quiet on a healthy host', () => {
    const outOfService = restartSafetyChecks({ unit, run: run(999), port: 7433, unitState: active, unitMainPid: 999, trackedPids: [] });
    expect(outOfService.some((c) => c.name === 'daemon on the listen address' && c.ok === false)).toBe(true);
    const healthy = restartSafetyChecks({ unit, run: run(4242), port: 7433, unitState: { ...active, mainPid: 4242 }, unitMainPid: 4242, trackedPids: [] });
    expect(healthy).toEqual([]);
  });
});
