import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LAUNCHD_LABEL, SERVICE_NAME, classifyRestart, commitSubjectsInRange, configDir, dataHome, findPortHolder,
  inOwnScope, isServerProcessCmdline, migrationsIn, parseListenPort, parseLsofHolder, parsePortHolder,
  parseUnitRuntimeState, planRestart, readUnitRuntimeState, releaseStamp, releaseVersion,
  resolveInstalledLaunchdAgent, resolveInstalledUnit, stateHome, type CommandResult, type RunCommand,
} from './index.js';

/** A RunCommand built from a table of `cmd args → output`, for the seam-only host tests. */
function fakeRun(table: Array<{ match: string[]; result: Partial<CommandResult> }>): RunCommand {
  return (cmd, args) => {
    const joined = [cmd, ...args].join(' ');
    for (const entry of table) {
      if (entry.match.every((m) => joined.includes(m))) return { status: 0, signal: null, stdout: '', stderr: '', ...entry.result };
    }
    return { status: 1, signal: null, stdout: '', stderr: `not found: ${joined}` };
  };
}

const tmps: string[] = [];
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

describe('dataHome / configDir / stateHome (VS-258)', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const k of ['AC_CONFIG_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ['AC_CONFIG_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
      if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
  });

  it('dataHome resolves old, new, fresh and refuses when both exist', () => {
    const base = tmp('ac-data-');
    process.env['XDG_DATA_HOME'] = base;
    expect(dataHome()).toBe(join(base, 'weave')); // fresh: neither exists yet
    mkdirSync(join(base, 'agent-conductor'));
    expect(dataHome()).toBe(join(base, 'agent-conductor'));
    mkdirSync(join(base, 'weave'));
    expect(() => dataHome()).toThrow(/ambiguous install/);
  });

  it('configDir resolves old, new, fresh, and an explicit override bypasses resolution entirely', () => {
    const base = tmp('ac-config-');
    process.env['XDG_CONFIG_HOME'] = base;
    expect(configDir()).toBe(join(base, 'weave'));
    mkdirSync(join(base, 'agent-conductor'));
    expect(configDir()).toBe(join(base, 'agent-conductor'));

    process.env['AC_CONFIG_HOME'] = '/explicit/override';
    expect(configDir()).toBe('/explicit/override');
  });

  it('stateHome resolves old, new and fresh', () => {
    const base = tmp('ac-state-');
    process.env['XDG_STATE_HOME'] = base;
    expect(stateHome()).toBe(join(base, 'weave'));
    mkdirSync(join(base, 'weave'));
    expect(stateHome()).toBe(join(base, 'weave'));
  });
});

describe('resolveInstalledUnit / resolveInstalledLaunchdAgent (VS-316)', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => { delete process.env['XDG_CONFIG_HOME']; delete process.env['HOME']; });
  afterEach(() => {
    for (const k of ['XDG_CONFIG_HOME', 'HOME']) {
      if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
  });

  it('resolves nothing when neither name is installed', () => {
    process.env['XDG_CONFIG_HOME'] = tmp('ac-unit-none-');
    expect(resolveInstalledUnit()).toBeNull();
  });

  it('resolves the legacy name when only it is installed', () => {
    const base = tmp('ac-unit-legacy-');
    process.env['XDG_CONFIG_HOME'] = base;
    const dir = join(base, 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-conductor.service'), '[Service]\n');
    expect(resolveInstalledUnit()).toEqual({ name: 'agent-conductor.service', path: join(dir, 'agent-conductor.service'), legacy: true });
  });

  it('resolves the current name when only it is installed', () => {
    const base = tmp('ac-unit-current-');
    process.env['XDG_CONFIG_HOME'] = base;
    const dir = join(base, 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    expect(resolveInstalledUnit()).toEqual({ name: SERVICE_NAME, path: join(dir, SERVICE_NAME), legacy: false });
  });

  it('prefers the legacy name when both are installed (PR #265 review: an interrupted migration must not look finished)', () => {
    const base = tmp('ac-unit-both-');
    process.env['XDG_CONFIG_HOME'] = base;
    const dir = join(base, 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\n');
    writeFileSync(join(dir, 'agent-conductor.service'), '[Service]\n');
    expect(resolveInstalledUnit()).toMatchObject({ name: 'agent-conductor.service', legacy: true });
  });

  it('resolves the launchd agent the same way, legacy label preferred when both exist', () => {
    const base = tmp('ac-agent-');
    process.env['HOME'] = base;
    const dir = join(base, 'Library', 'LaunchAgents');
    mkdirSync(dir, { recursive: true });
    expect(resolveInstalledLaunchdAgent()).toBeNull();
    writeFileSync(join(dir, 'com.agent-conductor.daemon.plist'), '<plist/>');
    expect(resolveInstalledLaunchdAgent()).toEqual({ label: 'com.agent-conductor.daemon', path: join(dir, 'com.agent-conductor.daemon.plist'), legacy: true });
    // Both now exist (as after an interrupted migration): still the legacy one, not the new file's
    // mere presence.
    writeFileSync(join(dir, `${LAUNCHD_LABEL}.plist`), '<plist/>');
    expect(resolveInstalledLaunchdAgent()).toMatchObject({ label: 'com.agent-conductor.daemon', legacy: true });
  });
});

describe('planRestart', () => {
  const base = { platform: 'linux' as NodeJS.Platform, unit: null, launchdAgent: null, systemdRunAvailable: false };
  const currentUnit = { name: SERVICE_NAME, path: `/x/${SERVICE_NAME}`, legacy: false };
  const legacyUnit = { name: 'agent-conductor.service', path: '/x/agent-conductor.service', legacy: true };
  const currentAgent = { label: LAUNCHD_LABEL, path: `/x/${LAUNCHD_LABEL}.plist`, legacy: false };

  it('restarts through systemd and gives the runner its own scope when it can', () => {
    const plan = planRestart({ ...base, unit: currentUnit, systemdRunAvailable: true });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] });
    expect(plan.launch).toBe('systemd-run');
    expect(plan.runnerSurvives).toBe(true);
  });

  it('still restarts through systemd without systemd-run, but says the runner will not survive', () => {
    const plan = planRestart({ ...base, unit: currentUnit, systemdRunAvailable: false });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] });
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(false);
  });

  it('targets the unit that is actually installed, not the current name, when only the legacy one is present', () => {
    const plan = planRestart({ ...base, unit: legacyUnit, systemdRunAvailable: true });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', 'agent-conductor.service'] });
    expect(plan.how).toBe('systemctl --user restart agent-conductor.service');
  });

  it('kickstarts the launchd agent on macOS, where a detached child survives', () => {
    const plan = planRestart({ ...base, platform: 'darwin', launchdAgent: currentAgent, uid: 501 });
    expect(plan.restart).toEqual({ cmd: 'launchctl', args: ['kickstart', '-k', `gui/501/${LAUNCHD_LABEL}`] });
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(true);
  });

  it('falls back to stopping and starting the daemon when no service manager owns it', () => {
    const plan = planRestart(base);
    expect(plan.restart).toBeNull();
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(true);
    expect(planRestart({ ...base, platform: 'darwin' }).restart).toBeNull();
    expect(planRestart({ ...base, platform: 'win32', unit: currentUnit }).restart).toBeNull();
  });

  it('wraps a command into a transient scope', () => {
    expect(inOwnScope('ac-upgrade-1', 'node', ['bin.js', 'x'])).toEqual({
      cmd: 'systemd-run',
      args: ['--user', '--scope', '--collect', '--unit=ac-upgrade-1', '--quiet', 'node', 'bin.js', 'x'],
    });
  });
});

describe('commitSubjectsInRange', () => {
  /** A real throwaway repo with one commit per subject, in order; returns each commit's sha. */
  function repoWithCommits(subjects: string[]): { root: string; shas: string[] } {
    const root = mkdtempSync(join(tmpdir(), 'ac-relgit-'));
    tmps.push(root);
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const shas: string[] = [];
    for (const subject of subjects) {
      git('commit', '--allow-empty', '-q', '-m', subject);
      shas.push(git('rev-parse', 'HEAD'));
    }
    return { root, shas };
  }

  it('reads commit subjects strictly after `from` up to and including `to`', () => {
    const { root, shas } = repoWithCommits(['first', 'second', 'third', 'fourth']);
    expect(commitSubjectsInRange(root, shas[0]!, shas[2]!)).toEqual(['second', 'third']);
  });

  it('is empty when either sha is null', () => {
    const { root, shas } = repoWithCommits(['first', 'second']);
    expect(commitSubjectsInRange(root, null, shas[1]!)).toEqual([]);
    expect(commitSubjectsInRange(root, shas[0]!, null)).toEqual([]);
  });

  it('is empty for a directory with no readable .git, rather than throwing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'ac-relgit-none-'));
    tmps.push(bare);
    expect(commitSubjectsInRange(bare, 'a'.repeat(40), 'b'.repeat(40))).toEqual([]);
  });

  it('is empty when the shas do not resolve in this clone, rather than throwing', () => {
    const { root } = repoWithCommits(['only commit']);
    expect(commitSubjectsInRange(root, 'a'.repeat(40), 'b'.repeat(40))).toEqual([]);
  });
});

describe('releaseVersion / releaseStamp', () => {
  it('reads the sha and stamp from a named release directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'ac-relver-'));
    tmps.push(home);
    const root = join(home, '20260909-210807-abc1234def');
    mkdirSync(root);
    expect(releaseVersion(root)).toBe('abc1234def');
    expect(releaseStamp(root)).toBe('20260909-210807');
  });

  it('reports unknown when neither git nor the directory name yields a sha', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-relver-none-'));
    tmps.push(root);
    expect(releaseVersion(root)).toBe('unknown');
    expect(releaseStamp(root)).toBeNull();
  });
});

describe('migrationsIn (VS-315)', () => {
  it('lists a release\'s migration files, sorted', () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-relmig-'));
    tmps.push(root);
    const dir = join(root, 'packages', 'db', 'dist', 'migrations');
    mkdirSync(dir, { recursive: true });
    for (const f of ['0031_b.sql', '0030_a.sql', 'settings.txt']) writeFileSync(join(dir, f), '');
    expect(migrationsIn(root)).toEqual(['0030_a.sql', '0031_b.sql']);
  });

  it('is empty for a missing release and for a null one, rather than throwing', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'ac-relmig-none-')), 'nope');
    expect(migrationsIn(missing)).toEqual([]);
    expect(migrationsIn(null)).toEqual([]);
  });
});

describe('readUnitRuntimeState (VS-407)', () => {
  const unit = { name: SERVICE_NAME, path: `/x/${SERVICE_NAME}`, legacy: false };

  it('parses systemctl show Key=Value output', () => {
    expect(parseUnitRuntimeState('ActiveState=active\nSubState=running\nNRestarts=3\nMainPID=1234\nUnknown=x\n')).toEqual({
      activeState: 'active', subState: 'running', nRestarts: 3, mainPid: 1234,
    });
  });

  it('treats an inactive unit with no main pid as null, not zero', () => {
    expect(parseUnitRuntimeState('ActiveState=failed\nSubState=failed\nNRestarts=0\nMainPID=0\n')).toEqual({
      activeState: 'failed', subState: 'failed', nRestarts: 0, mainPid: null,
    });
  });

  it('reads through a runner and returns sentinels when the read fails', () => {
    const ok = readUnitRuntimeState(unit, fakeRun([{ match: ['systemctl', 'show'], result: { stdout: 'ActiveState=active\nMainPID=42\n' } }]));
    expect(ok).toMatchObject({ activeState: 'active', mainPid: 42 });
    const bad = readUnitRuntimeState(unit, () => ({ status: 1, signal: null, stdout: '', stderr: 'no systemd' }));
    expect(bad).toEqual({ activeState: null, subState: null, nRestarts: null, mainPid: null });
  });
});

describe('parseListenPort (VS-407)', () => {
  it('reads an explicit port from an http or https URL', () => {
    expect(parseListenPort('https://100.64.0.10:7433')).toBe(7433);
    expect(parseListenPort('http://127.0.0.1:7440')).toBe(7440);
  });

  it('falls back to the scheme default and is null for a unix socket or garbage', () => {
    expect(parseListenPort('https://host')).toBe(443);
    expect(parseListenPort('http://host')).toBe(80);
    expect(parseListenPort('unix:///run/weave.sock')).toBeNull();
    expect(parseListenPort('')).toBeNull();
    expect(parseListenPort(null)).toBeNull();
  });
});

describe('port holder lookup (VS-407)', () => {
  const ssLine = 'LISTEN 0      511          0.0.0.0:7433       0.0.0.0:*    users:(("node",pid=12345,fd=22))\n';
  const lsofOut = 'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode    12345 user   22u  IPv4  12345      0t0  TCP *:7433 (LISTEN)\n';

  it('parses an ss line and an lsof line', () => {
    expect(parsePortHolder(ssLine)).toEqual({ pid: 12345, command: 'node' });
    expect(parseLsofHolder(lsofOut)).toEqual({ pid: 12345, command: 'node' });
    expect(parsePortHolder('State Recv-Q Send-Q\n')).toBeNull();
    expect(parseLsofHolder('COMMAND PID USER\n')).toBeNull();
  });

  it('prefers ss, falls back to lsof, and reports nothing when neither yields a holder', () => {
    expect(findPortHolder(7433, fakeRun([{ match: ['ss', 'sport = :7433'], result: { stdout: ssLine } }]))).toEqual({ pid: 12345, command: 'node' });
    expect(findPortHolder(7433, fakeRun([{ match: ['lsof', '-iTCP:7433'], result: { stdout: lsofOut } }]))).toEqual({ pid: 12345, command: 'node' });
    expect(findPortHolder(7433, () => ({ status: 1, signal: null, stdout: '', stderr: 'absent' }))).toBeNull();
  });
});

describe('classifyRestart / isServerProcessCmdline (VS-407)', () => {
  const unit = { name: SERVICE_NAME, path: `/x/${SERVICE_NAME}`, legacy: false };

  it('recognises this product\'s server command line', () => {
    expect(isServerProcessCmdline('/home/u/.local/share/weave/releases/1/packages/server/dist/bin.js\0')).toBe(true);
    expect(isServerProcessCmdline('node\0/app/other.js\0')).toBe(false);
  });

  it('classifies the holder relative to the unit and the tracked pids', () => {
    expect(classifyRestart({ unit, holder: { pid: 42, command: 'node' }, unitMainPid: 42, trackedPids: [] }).kind).toBe('unit');
    expect(classifyRestart({ unit, holder: { pid: 99, command: 'node' }, unitMainPid: 42, trackedPids: [99] }).kind).toBe('detached');
    expect(classifyRestart({ unit, holder: { pid: 77, command: 'node' }, unitMainPid: 42, trackedPids: [99] }).kind).toBe('other');
    expect(classifyRestart({ unit, holder: null, unitMainPid: 42, trackedPids: [] }).kind).toBe('none');
    expect(classifyRestart({ unit: null, holder: { pid: 1, command: 'node' }, unitMainPid: null, trackedPids: [] }).kind).toBe('none');
  });
});
