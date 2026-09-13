import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Db, nowIso } from '@weave-ai/db';
import { LAUNCHD_LABEL, SERVICE_NAME } from '@weave-ai/release';

vi.mock('./daemon.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./daemon.js')>();
  return {
    ...actual,
    stopDaemon: vi.fn(async () => ({ stopped: true, pid: 111 })),
    startDaemon: vi.fn(() => ({ pid: 777, bin: '/bin/node', log: '/tmp/log', foreground: false })),
  };
});

import { stopDaemon, startDaemon } from './daemon.js';
import {
  HEALTH_DEADLINE_MS, driveRestart, migrateLaunchdAgent, recordRestartCommandFailure, recordVerdict, restartCommand,
  type CommandResult, type HealthProbe, type RestartOutcome, type RunCommand, type RunnerIo, type RunnerVerdict,
} from './upgrade-runner.js';

const TARGET = { release: '/rel/20260202-120000-bbbbbbbbbb', sha: 'b'.repeat(40) };
const SERVICE_PID = 550308;

interface FakeHost extends RunnerIo { restarts: number; rollbacks: string[]; clock: number }

/**
 * A host that never exists: every effect is recorded, and the clock only moves when we sleep.
 * `confirmsReplacement` defaults to always `null` ("can't tell"), preserving the pre-VS-316
 * release-match-only behavior for every test that doesn't care about it.
 */
function io(over: Partial<RunnerIo> & { answers?: Array<HealthProbe | null> } = {}): FakeHost {
  const answers = over.answers ?? [];
  const state: FakeHost = {
    restarts: 0,
    rollbacks: [],
    clock: 1_000_000,
    restart: async (): Promise<void> => { state.restarts += 1; },
    probe: async (): Promise<HealthProbe | null> => (answers.length ? answers.shift()! : null),
    rollbackTo: (release: string): void => { state.rollbacks.push(release); },
    previousRelease: (): string | null => '/rel/20260101-120000-aaaaaaaaaa',
    now: (): number => state.clock,
    sleep: async (ms: number): Promise<void> => { state.clock += ms; },
    alreadyCompleted: async (): Promise<boolean> => false,
    confirmsReplacement: async (): Promise<boolean | null> => null,
    ...over,
  };
  return state;
}

const healthy = (over: Partial<HealthProbe> = {}): HealthProbe =>
  ({ ok: true, version: '1.1.0', releasePath: TARGET.release, releaseSha: TARGET.sha, pid: SERVICE_PID, ...over });

describe('driveRestart', () => {
  it('restarts once and completes when the target answers healthy', async () => {
    const host = io({ answers: [null, null, healthy()] });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toEqual({ outcome: 'completed', version: '1.1.0' });
    expect(host.restarts).toBe(1);
    expect(host.rollbacks).toEqual([]);
  });

  it('accepts the target identified by its commit when the path differs', async () => {
    const host = io({ answers: [healthy({ releasePath: '/rel/somewhere-else' })] });
    await expect(driveRestart(TARGET, host)).resolves.toMatchObject({ outcome: 'completed' });
  });

  it('keeps waiting through a daemon that answers on the old release', async () => {
    const host = io({ answers: [healthy({ releasePath: '/rel/20260101-120000-aaaaaaaaaa', releaseSha: 'a'.repeat(40) }), healthy()] });
    await expect(driveRestart(TARGET, host)).resolves.toMatchObject({ outcome: 'completed' });
    expect(host.rollbacks).toEqual([]);
  });

  it('rolls back to previous and restarts again when the target never answers', async () => {
    const host = io({ answers: [] });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toMatchObject({ outcome: 'rolled_back', to: '/rel/20260101-120000-aaaaaaaaaa' });
    expect(host.rollbacks).toEqual(['/rel/20260101-120000-aaaaaaaaaa']);
    expect(host.restarts).toBe(2);
    expect((verdict as { message: string }).message).toContain(TARGET.release);
  });

  it('does not roll back to a release that never answered ok', async () => {
    const host = io({ answers: [{ ok: false, version: null, releasePath: TARGET.release, releaseSha: TARGET.sha, pid: SERVICE_PID }] });
    await expect(driveRestart(TARGET, host)).resolves.toMatchObject({ outcome: 'rolled_back' });
  });

  it('reports that nothing can be done when there is no previous release', async () => {
    const host = io({ previousRelease: () => null });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toMatchObject({ outcome: 'gone' });
    expect(host.rollbacks).toEqual([]);
    expect(host.restarts).toBe(1);
  });

  it('gives up only after the health deadline', async () => {
    const host = io();
    const started = host.clock;
    await driveRestart(TARGET, host);
    expect(host.clock - started).toBeGreaterThanOrEqual(HEALTH_DEADLINE_MS);
  });

  it('does not roll back once boot-time reconciliation has already recorded the upgrade completed (VS-115)', async () => {
    // The probe never answers ok, as if a transient hiccup were hiding an otherwise healthy daemon —
    // but reconciliation, a faster and more reliable in-process fact, got there first.
    let checks = 0;
    const host = io({ probe: async () => null, alreadyCompleted: async () => { checks += 1; return checks >= 2; } });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toEqual({ outcome: 'completed', version: null });
    expect(host.rollbacks).toEqual([]);
    expect(host.restarts).toBe(1);
  });

  it('completes when the probe on target is confirmed to be the process that was replaced (VS-316)', async () => {
    const host = io({ answers: [healthy({ pid: SERVICE_PID })], confirmsReplacement: async (pid) => pid === SERVICE_PID });
    await expect(driveRestart(TARGET, host)).resolves.toEqual({ outcome: 'completed', version: '1.1.0' });
  });

  it('does not complete on a probe answered by a process other than the one replaced, and eventually rolls back (VS-316)', async () => {
    const strayPid = 999999;
    const host = io({ answers: [], probe: async () => healthy({ pid: strayPid }), confirmsReplacement: async (pid) => pid === SERVICE_PID });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toMatchObject({ outcome: 'rolled_back' });
  });

  it('accepts an on-target probe when confirmation cannot be made either way (VS-316)', async () => {
    // Preserves the pre-VS-316 release-match-only behavior for a host this can't verify on.
    const host = io({ answers: [healthy()], confirmsReplacement: async () => null });
    await expect(driveRestart(TARGET, host)).resolves.toEqual({ outcome: 'completed', version: '1.1.0' });
  });

  it("propagates a restart command failure rather than swallowing it (VS-316)", async () => {
    const host = io({ restart: async () => { throw new Error('systemctl --user restart weave-ai.service exited 5: Unit not found.'); } });
    await expect(driveRestart(TARGET, host)).rejects.toThrow('Unit not found');
  });
});

describe('recordVerdict', () => {
  const seed = (): { db: Db; id: string } => {
    const db = new Db(':memory:');
    db.migrate();
    db.insert('upgrades', {
      id: 'u1', state: 'restarting', source: '/src', ref: 'main', requestedBy: 'op1',
      requestedAt: nowIso(), startedAt: nowIso(), toRelease: TARGET.release, toSha: TARGET.sha,
      logJson: [], backupsJson: [],
    });
    return { db, id: 'u1' };
  };

  it('completes the record with the version the daemon came back on', () => {
    const { db, id } = seed();
    recordVerdict(db, id, { outcome: 'completed', version: '1.1.0' });
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'completed', cameBackVersion: '1.1.0', reason: null });
    db.close();
  });

  it('fails the record with restart_failed after a rollback', () => {
    const { db, id } = seed();
    const verdict: RunnerVerdict = { outcome: 'rolled_back', to: '/rel/old', message: 'no healthy daemon' };
    recordVerdict(db, id, verdict);
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'failed', reason: 'restart_failed', message: 'no healthy daemon' });
    db.close();
  });

  it('fails the record with restart_unverified when there was nothing to roll back to', () => {
    const { db, id } = seed();
    recordVerdict(db, id, { outcome: 'gone', message: 'no previous release' });
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'failed', reason: 'restart_unverified' });
    db.close();
  });

  it('leaves an already-terminal record unchanged (VS-115): reconciliation, or an earlier call, won already', () => {
    const { db, id } = seed();
    db.update('upgrades', id, { state: 'completed', finishedAt: nowIso(), cameBackVersion: '1.1.0' });
    recordVerdict(db, id, { outcome: 'rolled_back', to: '/rel/old', message: 'no healthy daemon' });
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'completed', cameBackVersion: '1.1.0', reason: null });
    db.close();
  });
});

describe('recordRestartCommandFailure (VS-316)', () => {
  const seed = (): { db: Db; id: string } => {
    const db = new Db(':memory:');
    db.migrate();
    db.insert('upgrades', {
      id: 'u1', state: 'restarting', source: '/src', ref: 'main', requestedBy: 'op1',
      requestedAt: nowIso(), startedAt: nowIso(), toRelease: TARGET.release, toSha: TARGET.sha,
      logJson: [], backupsJson: [],
    });
    return { db, id: 'u1' };
  };

  it('fails the record with restart_failed and the command failure message', () => {
    const { db, id } = seed();
    recordRestartCommandFailure(db, id, 'systemctl --user restart weave-ai.service exited 5: Unit not found.');
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({
      state: 'failed', reason: 'restart_failed', message: 'systemctl --user restart weave-ai.service exited 5: Unit not found.',
    });
    db.close();
  });

  it('leaves an already-terminal record unchanged, same guard as recordVerdict', () => {
    const { db, id } = seed();
    db.update('upgrades', id, { state: 'completed', finishedAt: nowIso(), cameBackVersion: '1.1.0' });
    recordRestartCommandFailure(db, id, 'should never land');
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'completed', cameBackVersion: '1.1.0', reason: null });
    db.close();
  });
});

describe('restartCommand (VS-316)', () => {
  const tmps: string[] = [];
  const savedXdg = process.env['XDG_CONFIG_HOME'];
  afterEach(() => {
    while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
    if (savedXdg === undefined) delete process.env['XDG_CONFIG_HOME']; else process.env['XDG_CONFIG_HOME'] = savedXdg;
    vi.mocked(stopDaemon).mockClear();
    vi.mocked(startDaemon).mockClear();
    vi.unstubAllGlobals();
  });

  function scratchUnitDir(): string {
    const base = mkdtempSync(join(tmpdir(), 'ac-restart-cmd-'));
    tmps.push(base);
    process.env['XDG_CONFIG_HOME'] = base;
    const dir = join(base, 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  const noopCommand = (result: Partial<CommandResult> = {}): CommandResult =>
    ({ status: 0, signal: null, stdout: '', stderr: '', ...result });

  it('fails loudly, with stderr, when the restart command exits non-zero', async () => {
    const dir = scratchUnitDir();
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    const run: RunCommand = () => noopCommand({ status: 5, stderr: 'Unit weave-ai.service could not be found.\n' });
    const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
    await expect(outcome.run()).rejects.toThrow('Unit weave-ai.service could not be found.');
  });

  it('fails loudly when the restart command cannot even start', async () => {
    const dir = scratchUnitDir();
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    const run: RunCommand = () => noopCommand({ status: null, error: new Error('ENOENT') });
    const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
    await expect(outcome.run()).rejects.toThrow('failed to start');
  });

  it('confirms replacement via MainPID equality (the fast path)', async () => {
    const dir = scratchUnitDir();
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    const run: RunCommand = (cmd, args) => (args.includes('show') ? noopCommand({ stdout: '550308\n' }) : noopCommand());
    const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
    await expect(outcome.confirmsReplacement(550308)).resolves.toBe(true);
    await expect(outcome.confirmsReplacement(1)).resolves.toBe(false); // MainPID known and different, cgroup doesn't name the unit either
  });

  it('falls back to the cgroup check when MainPID names a wrapper process', async () => {
    const dir = scratchUnitDir();
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    const run: RunCommand = (cmd, args) => (args.includes('show') ? noopCommand({ stdout: '111\n' }) : noopCommand());
    const outcome = restartCommand('/cfg', { run, readCgroup: (pid) => (pid === 550308 ? `0::/user.slice/user@1000.service/app.slice/${SERVICE_NAME}\n` : '') });
    await expect(outcome.confirmsReplacement(550308)).resolves.toBe(true);
  });

  it('cannot confirm when neither MainPID nor the cgroup can be read', async () => {
    const dir = scratchUnitDir();
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    const run: RunCommand = () => noopCommand({ status: 1 });
    const outcome = restartCommand('/cfg', { run, readCgroup: () => { throw new Error('no /proc'); } });
    await expect(outcome.confirmsReplacement(550308)).resolves.toBeNull();
  });

  it('never starts a second daemon while something still answers, on the no-unit fallback', async () => {
    scratchUnitDir(); // empty: no unit installed, so planRestart falls back to stop-then-start directly
    const configDir = mkdtempSync(join(tmpdir(), 'ac-restart-cmd-cfg-'));
    tmps.push(configDir);
    writeFileSync(join(configDir, 'daemon.json'), JSON.stringify({ loopbackUrl: 'http://127.0.0.1:1/' }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
    const outcome = restartCommand(configDir, { run: () => noopCommand(), readCgroup: () => '' });
    await expect(outcome.run()).rejects.toThrow(/still answering/);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(startDaemon).not.toHaveBeenCalled();
  });

  describe('unit migration (VS-316, Decision 4)', () => {
    function installLegacyUnit(content = '[Unit]\nDescription=AgentConductor daemon\n\n[Service]\nExecStart=/bin/node /x/bin.js\nEnvironment=AC_CONFIG_HOME=/x\nTimeoutStopSec=255\n\n[Install]\nWantedBy=default.target\n'): string {
      const dir = scratchUnitDir();
      const path = join(dir, 'agent-conductor.service');
      writeFileSync(path, content);
      return path;
    }

    /**
     * Routes each systemctl call to a scripted response keyed by its verb and target together (e.g.
     * `'start weave-ai.service'`, `'daemon-reload'`), so cutover's `start <new>` and the fallback's
     * `start <legacy>` can be scripted independently. Records the call order.
     */
    function fakeSystemctl(responses: Record<string, CommandResult> = {}): { run: RunCommand; calls: string[][] } {
      const calls: string[][] = [];
      const run: RunCommand = (cmd, args) => {
        calls.push([cmd, ...args]);
        const key = args.slice(1).join(' '); // drop the leading '--user'
        return responses[key] ?? noopCommand();
      };
      return { run, calls };
    }

    it('migrates end to end: prepare, cutover, and (once the caller confirms completion) finalize', async () => {
      const legacyPath = installLegacyUnit();
      const { run, calls } = fakeSystemctl();
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await outcome.run();
      expect(calls).toEqual([
        ['systemctl', '--user', 'daemon-reload'],
        ['systemctl', '--user', 'enable', SERVICE_NAME],
        ['systemctl', '--user', 'stop', 'agent-conductor.service'],
        ['systemctl', '--user', 'start', SERVICE_NAME],
      ]);
      const newContent = readFileSync(join(legacyPath, '..', SERVICE_NAME), 'utf8');
      expect(newContent).toContain('Description=Weave AI daemon');
      expect(newContent).toContain('TimeoutStopSec=255'); // carried over verbatim, not re-rendered
      expect(newContent).toContain('Environment=AC_CONFIG_HOME=/x');
      expect(outcome.migrationOutcome()).toBe('migrated');
      expect(existsSync(legacyPath)).toBe(true); // not retired yet — only finalizeMigration() does that

      await outcome.finalizeMigration();
      expect(calls.slice(4)).toEqual([
        ['systemctl', '--user', 'disable', 'agent-conductor.service'],
        ['systemctl', '--user', 'daemon-reload'],
      ]);
      expect(existsSync(legacyPath)).toBe(false);
      expect(existsSync(`${legacyPath}.migrated`)).toBe(true);
    });

    it('carries a drop-in directory over before cutover, and retires it (not deletes) at finalize', async () => {
      const legacyPath = installLegacyUnit();
      mkdirSync(`${legacyPath}.d`, { recursive: true });
      writeFileSync(join(`${legacyPath}.d`, '10-path.conf'), '[Service]\nEnvironment=PATH=/custom\n');
      const { run } = fakeSystemctl();
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await outcome.run();
      const newDropIn = join(legacyPath, '..', `${SERVICE_NAME}.d`);
      expect(existsSync(join(newDropIn, '10-path.conf'))).toBe(true);
      expect(existsSync(`${legacyPath}.d`)).toBe(true); // still present until finalize

      await outcome.finalizeMigration();
      expect(existsSync(`${legacyPath}.d`)).toBe(false);
      expect(existsSync(`${legacyPath}.d.migrated`)).toBe(true);
    });

    it('falls back to the legacy unit, without failing, when cutover fails to start the new unit — and undoes prepare', async () => {
      const legacyPath = installLegacyUnit();
      const { run, calls } = fakeSystemctl({ [`start ${SERVICE_NAME}`]: { status: 1, signal: null, stdout: '', stderr: 'bind: address in use' } });
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await expect(outcome.run()).resolves.toBeUndefined(); // not thrown: the upgrade still completes, on the legacy unit
      expect(outcome.migrationOutcome()).toBe('fallback');
      // The fallback-start call happens, then prepare's leftovers (the new unit file, its would-be
      // enablement) are undone — a later upgrade must not find a stray weave-ai.service (PR #265 review).
      expect(calls).toEqual([
        ['systemctl', '--user', 'daemon-reload'],
        ['systemctl', '--user', 'enable', SERVICE_NAME],
        ['systemctl', '--user', 'stop', 'agent-conductor.service'],
        ['systemctl', '--user', 'start', SERVICE_NAME],
        ['systemctl', '--user', 'start', 'agent-conductor.service'],
        ['systemctl', '--user', 'stop', SERVICE_NAME],
        ['systemctl', '--user', 'disable', SERVICE_NAME],
        ['systemctl', '--user', 'daemon-reload'],
      ]);
      expect(existsSync(join(legacyPath, '..', SERVICE_NAME))).toBe(false);
    });

    it('never starts the new unit at all when stopping the legacy one fails, and never leaves both running (PR #265 review, round 2)', async () => {
      installLegacyUnit();
      const { run, calls } = fakeSystemctl({ 'stop agent-conductor.service': { status: 1, signal: null, stdout: '', stderr: 'stop job cancelled' } });
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await expect(outcome.run()).resolves.toBeUndefined();
      expect(outcome.migrationOutcome()).toBe('fallback');
      // `start weave-ai.service` is never called — the legacy stop's own failure is enough to skip it.
      expect(calls.some((c) => c.join(' ') === `systemctl --user start ${SERVICE_NAME}`)).toBe(false);
      expect(calls).toContainEqual(['systemctl', '--user', 'start', 'agent-conductor.service']);
    });

    it('confirms replacement against the legacy unit after a cutover fallback, not the never-started new one', async () => {
      installLegacyUnit();
      const { run } = fakeSystemctl({
        [`start ${SERVICE_NAME}`]: { status: 1, signal: null, stdout: '', stderr: 'bind: address in use' },
        'show agent-conductor.service --property=MainPID --value': { status: 0, signal: null, stdout: '42\n', stderr: '' },
      });
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await outcome.run();
      await expect(outcome.confirmsReplacement(42)).resolves.toBe(true);
    });

    it('fails the upgrade only when neither the new unit nor the legacy fallback comes up', async () => {
      installLegacyUnit();
      const { run } = fakeSystemctl({
        [`start ${SERVICE_NAME}`]: { status: 1, signal: null, stdout: '', stderr: 'nope' },
        'start agent-conductor.service': { status: 1, signal: null, stdout: '', stderr: 'nope either' },
      });
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await expect(outcome.run()).rejects.toThrow(/also failed/);
    });

    it('a prepare failure never touches the legacy unit, undoes what it wrote, and falls back to an ordinary restart', async () => {
      const legacyPath = installLegacyUnit();
      const { run, calls } = fakeSystemctl({ 'daemon-reload': { status: 1, signal: null, stdout: '', stderr: 'permission denied' } });
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await outcome.run();
      expect(outcome.migrationOutcome()).toBe('prepare_failed');
      expect(calls).toEqual([
        ['systemctl', '--user', 'daemon-reload'],
        ['systemctl', '--user', 'stop', SERVICE_NAME],
        ['systemctl', '--user', 'disable', SERVICE_NAME],
        ['systemctl', '--user', 'daemon-reload'],
        ['systemctl', '--user', 'restart', 'agent-conductor.service'],
      ]);
      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(`${legacyPath}.migrated`)).toBe(false);
      expect(existsSync(join(legacyPath, '..', SERVICE_NAME))).toBe(false);
    });

    it('reverts a successful cutover — back to the legacy unit, new unit removed — when the deadline rollback calls a second time', async () => {
      const legacyPath = installLegacyUnit();
      const { run, calls } = fakeSystemctl();
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await outcome.run(); // migrates
      expect(outcome.migrationOutcome()).toBe('migrated');
      const callsAfterMigration = calls.length;

      await outcome.run(); // simulates driveRestart's rollback calling io.restart() again after the
      // release itself never verified healthy — the unit migration must not be left half-done.
      expect(calls.slice(callsAfterMigration)).toEqual([
        ['systemctl', '--user', 'stop', SERVICE_NAME],
        ['systemctl', '--user', 'start', 'agent-conductor.service'],
        ['systemctl', '--user', 'stop', SERVICE_NAME], // undoPrepare()'s own stop — harmless, already stopped
        ['systemctl', '--user', 'disable', SERVICE_NAME],
        ['systemctl', '--user', 'daemon-reload'],
      ]);
      expect(outcome.migrationOutcome()).toBe('fallback');
      expect(existsSync(join(legacyPath, '..', SERVICE_NAME))).toBe(false);
      // A third call (should the rollback itself ever be retried) is now an ordinary legacy restart,
      // not another revert attempt.
      await outcome.run();
      expect(calls.at(-1)).toEqual(['systemctl', '--user', 'restart', 'agent-conductor.service']);
    });

    it('fails loudly, rather than guessing, if the revert cannot confirm the new unit actually stopped (PR #265 review, round 2)', async () => {
      installLegacyUnit();
      const { run } = fakeSystemctl({ [`stop ${SERVICE_NAME}`]: { status: 1, signal: null, stdout: '', stderr: 'stop job cancelled' } });
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      await outcome.run(); // migrates
      await expect(outcome.run()).rejects.toThrow(/could not revert/); // never guesses that legacy is safe to start
    });

    it('does not migrate when the current unit is already installed', async () => {
      const dir = scratchUnitDir();
      writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
      const { run, calls } = fakeSystemctl();
      const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
      expect(outcome.how).not.toContain('migrate');
      await outcome.run();
      expect(calls).toEqual([['systemctl', '--user', 'restart', SERVICE_NAME]]);
      expect(outcome.migrationOutcome()).toBeNull();
    });

    describe('an interrupted migration never makes the next upgrade trust an un-replaced unit (PR #265 review)', () => {
      /** A fresh `restartCommand()` call, standing in for a completely separate, later upgrade. */
      const nextUpgrade = (run: RunCommand): RestartOutcome => restartCommand('/cfg', { run, readCgroup: () => '' });

      it('after a prepare failure, the next upgrade still resolves as legacy and never restarts the new name', async () => {
        installLegacyUnit();
        const first = fakeSystemctl({ 'daemon-reload': { status: 1, signal: null, stdout: '', stderr: 'permission denied' } });
        await restartCommand('/cfg', { run: first.run, readCgroup: () => '' }).run();

        const second = fakeSystemctl();
        const outcome = nextUpgrade(second.run);
        expect(outcome.how).toContain('migrate agent-conductor.service');
        await outcome.run();
        expect(second.calls.some((c) => c.includes(SERVICE_NAME) && c.includes('restart'))).toBe(false);
      });

      it('after a cutover fallback, the next upgrade still resolves as legacy and never restarts the new name', async () => {
        installLegacyUnit();
        const first = fakeSystemctl({ [`start ${SERVICE_NAME}`]: { status: 1, signal: null, stdout: '', stderr: 'bind: address in use' } });
        await restartCommand('/cfg', { run: first.run, readCgroup: () => '' }).run();

        const second = fakeSystemctl();
        const outcome = nextUpgrade(second.run);
        expect(outcome.how).toContain('migrate agent-conductor.service');
        await outcome.run();
        expect(second.calls.some((c) => c.includes(SERVICE_NAME) && c.includes('restart'))).toBe(false);
      });

      it('after a deadline-rollback revert, the next upgrade still resolves as legacy and never restarts the new name', async () => {
        installLegacyUnit();
        const first = fakeSystemctl();
        const firstOutcome = restartCommand('/cfg', { run: first.run, readCgroup: () => '' });
        await firstOutcome.run(); // migrates
        await firstOutcome.run(); // deadline rollback reverts

        const second = fakeSystemctl();
        const outcome = nextUpgrade(second.run);
        expect(outcome.how).toContain('migrate agent-conductor.service');
        await outcome.run();
        expect(second.calls.some((c) => c.includes(SERVICE_NAME) && c.includes('restart'))).toBe(false);
      });

      it('a host where both files already exist (e.g. an older, pre-fix leftover) never starts a second daemon: stop always precedes start', async () => {
        const legacyPath = installLegacyUnit();
        // Simulate the stale leftover this fix prevents going forward: the new unit file present
        // without ever having been the one actually running.
        writeFileSync(join(legacyPath, '..', SERVICE_NAME), '[Service]\n');
        const { run, calls } = fakeSystemctl();
        const outcome = restartCommand('/cfg', { run, readCgroup: () => '' });
        expect(outcome.how).toContain('migrate agent-conductor.service'); // legacy still wins
        await outcome.run();
        const stopIdx = calls.findIndex((c) => c.join(' ') === 'systemctl --user stop agent-conductor.service');
        const startIdx = calls.findIndex((c) => c.join(' ') === `systemctl --user start ${SERVICE_NAME}`);
        expect(stopIdx).toBeGreaterThanOrEqual(0);
        expect(startIdx).toBeGreaterThan(stopIdx); // never started before the legacy one was stopped
      });
    });

    describe('migrateLaunchdAgent (VS-316, best-effort — no macOS CI here; PR #265 review)', () => {
      function installLegacyPlist(): string {
        const dir = mkdtempSync(join(tmpdir(), 'ac-launchd-'));
        tmps.push(dir);
        const path = join(dir, 'com.agent-conductor.daemon.plist');
        writeFileSync(path, [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<plist version="1.0"><dict>',
          '  <key>Label</key>',
          '  <string>com.agent-conductor.daemon</string>',
          '  <key>ProgramArguments</key>',
          '  <array><string>/bin/node</string></array>',
          '</dict></plist>',
          '',
        ].join('\n'));
        return path;
      }

      it("rewrites the copied plist's Label to the current one, not the legacy one it was copied from", async () => {
        const legacyPath = installLegacyPlist();
        const { run } = fakeSystemctl();
        const outcome = migrateLaunchdAgent({ label: 'com.agent-conductor.daemon', path: legacyPath, legacy: true }, { run, readCgroup: () => '' });
        await outcome.run();
        const newPath = join(legacyPath, '..', `${LAUNCHD_LABEL}.plist`);
        const content = readFileSync(newPath, 'utf8');
        expect(content).toContain(`<key>Label</key>\n  <string>${LAUNCHD_LABEL}</string>`);
        expect(content).not.toContain('com.agent-conductor.daemon');
        expect(outcome.migrationOutcome()).toBe('migrated');
      });

      it('undoes the copied plist on a cutover failure, falls back to the legacy label, and does not fail the upgrade', async () => {
        const legacyPath = installLegacyPlist();
        const uid = process.getuid?.() ?? 0; // matches migrateLaunchdAgent's own uid lookup
        // fakeSystemctl's key drops args[0]; for launchctl that's the verb itself ('bootstrap'), not
        // '--user' as it is for systemctl, so the key here is just the remaining args.
        const { run } = fakeSystemctl({ [`gui/${uid} ${join(legacyPath, '..', `${LAUNCHD_LABEL}.plist`)}`]: { status: 1, signal: null, stdout: '', stderr: 'nope' } });
        const outcome = migrateLaunchdAgent({ label: 'com.agent-conductor.daemon', path: legacyPath, legacy: true }, { run, readCgroup: () => '' });
        await expect(outcome.run()).resolves.toBeUndefined();
        expect(outcome.migrationOutcome()).toBe('fallback');
        expect(existsSync(join(legacyPath, '..', `${LAUNCHD_LABEL}.plist`))).toBe(false);
      });

      it('never bootstraps the new label when booting out the legacy one fails, and never leaves both running (PR #265 review, round 2)', async () => {
        const legacyPath = installLegacyPlist();
        const uid = process.getuid?.() ?? 0;
        const { run, calls } = fakeSystemctl({ [`gui/${uid}/com.agent-conductor.daemon`]: { status: 1, signal: null, stdout: '', stderr: 'not found' } });
        const outcome = migrateLaunchdAgent({ label: 'com.agent-conductor.daemon', path: legacyPath, legacy: true }, { run, readCgroup: () => '' });
        await expect(outcome.run()).resolves.toBeUndefined();
        expect(outcome.migrationOutcome()).toBe('fallback');
        const newPath = join(legacyPath, '..', `${LAUNCHD_LABEL}.plist`);
        expect(calls.some((c) => c.includes('bootstrap') && c.includes(newPath))).toBe(false);
      });
    });

    describe('reproducing the incident end to end (VS-316, task 7): a legacy-named unit, SERVICE_NAME the new one', () => {
      it('migrates and completes once the new daemon answers healthy with a matching pid', async () => {
        const legacyPath = installLegacyUnit();
        const NEW_PID = 90909;
        const { run } = fakeSystemctl({ [`show ${SERVICE_NAME} --property=MainPID --value`]: { status: 0, signal: null, stdout: `${NEW_PID}\n`, stderr: '' } });
        const restart = restartCommand('/cfg', { run, readCgroup: () => '' });
        const host = io({ restart: restart.run, confirmsReplacement: restart.confirmsReplacement, answers: [healthy({ pid: NEW_PID })] });
        const verdict = await driveRestart(TARGET, host);
        expect(verdict).toEqual({ outcome: 'completed', version: '1.1.0' });
        expect(restart.migrationOutcome()).toBe('migrated');
        // Not recorded completed while the original process still serves: retirement only happens once
        // the caller (runUpgradeRunner, standing in as `restart.finalizeMigration()` here) confirms it.
        expect(existsSync(legacyPath)).toBe(true);
        await restart.finalizeMigration();
        expect(existsSync(legacyPath)).toBe(false);
      });

      it('falls back to the legacy unit on a cutover failure and still completes the upgrade', async () => {
        installLegacyUnit();
        const LEGACY_PID = 12321;
        const { run } = fakeSystemctl({
          [`start ${SERVICE_NAME}`]: { status: 1, signal: null, stdout: '', stderr: 'bind: address in use' },
          'show agent-conductor.service --property=MainPID --value': { status: 0, signal: null, stdout: `${LEGACY_PID}\n`, stderr: '' },
        });
        const restart = restartCommand('/cfg', { run, readCgroup: () => '' });
        const host = io({ restart: restart.run, confirmsReplacement: restart.confirmsReplacement, answers: [healthy({ pid: LEGACY_PID })] });
        const verdict = await driveRestart(TARGET, host);
        expect(verdict).toEqual({ outcome: 'completed', version: '1.1.0' });
        expect(restart.migrationOutcome()).toBe('fallback');
      });

      it('never records completed while a probe reports the original, unreplaced pid — even naming the target release', async () => {
        const ORIGINAL_PID = 765706; // the incident's own evidence: pid 765706 kept serving throughout
        installLegacyUnit();
        const { run } = fakeSystemctl({ [`show ${SERVICE_NAME} --property=MainPID --value`]: { status: 0, signal: null, stdout: '90909\n', stderr: '' } });
        const restart = restartCommand('/cfg', { run, readCgroup: () => '' });
        // The stray/original process keeps answering forever, honestly reporting the target release
        // (as `release-info.ts` derives it from module location) but its own, unreplaced pid.
        const host = io({ restart: restart.run, confirmsReplacement: restart.confirmsReplacement, probe: async () => healthy({ pid: ORIGINAL_PID }) });
        const verdict = await driveRestart(TARGET, host);
        expect(verdict.outcome).not.toBe('completed');
      });
    });
  });
});
