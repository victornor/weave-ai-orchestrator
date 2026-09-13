import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LAUNCHD_LABEL, SERVICE_NAME, commitSubjectsInRange, configDir, dataHome, inOwnScope, migrationsIn, planRestart,
  releaseStamp, releaseVersion, stateHome,
} from './index.js';

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

describe('planRestart', () => {
  const base = { platform: 'linux' as NodeJS.Platform, unitInstalled: false, launchdInstalled: false, systemdRunAvailable: false };

  it('restarts through systemd and gives the runner its own scope when it can', () => {
    const plan = planRestart({ ...base, unitInstalled: true, systemdRunAvailable: true });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] });
    expect(plan.launch).toBe('systemd-run');
    expect(plan.runnerSurvives).toBe(true);
  });

  it('still restarts through systemd without systemd-run, but says the runner will not survive', () => {
    const plan = planRestart({ ...base, unitInstalled: true, systemdRunAvailable: false });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] });
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(false);
  });

  it('kickstarts the launchd agent on macOS, where a detached child survives', () => {
    const plan = planRestart({ ...base, platform: 'darwin', launchdInstalled: true, uid: 501 });
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
    expect(planRestart({ ...base, platform: 'win32', unitInstalled: true }).restart).toBeNull();
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
