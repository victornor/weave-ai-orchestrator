import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { resolveRemoteSha } from '@weave-ai/release';
import { createUpdateChecker, describeRelease } from '../src/release-info.js';

const tmps: string[] = [];
function tmpDir(prefix = 'ac-rel-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { encoding: 'utf8' });
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# release\n', 'utf8');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return git(['rev-parse', 'HEAD']);
}

const daemon = (upgrade: Record<string, unknown>) => DaemonConfigSchema.parse({ upgrade });

describe('the running release', () => {
  it('reports the commit from the release own clone', () => {
    const root = join(tmpDir(), '20260101-120000-aaaaaaaaaa');
    const sha = initRepo(root);
    expect(describeRelease(root, '1.2.3')).toEqual({ version: '1.2.3', path: root, sha });
  });

  it('falls back to the <stamp>-<sha> directory name when the clone is gone', () => {
    const root = join(tmpDir(), '20260101-120000-abcdef1234');
    mkdirSync(root, { recursive: true });
    expect(describeRelease(root, '1.2.3').sha).toBe('abcdef1234');
  });

  it('reports no commit rather than a wrong one when neither resolves', () => {
    const root = join(tmpDir(), 'not-a-release');
    mkdirSync(root, { recursive: true });
    expect(describeRelease(root, '1.2.3').sha).toBeNull();
  });

  it('reports the directory it runs from, not what `current` points at', () => {
    const home = tmpDir();
    const running = join(home, '20260101-120000-aaaaaaaaaa');
    const other = join(home, '20260202-120000-bbbbbbbbbb');
    const runningSha = initRepo(running);
    initRepo(other);
    symlinkSync(other, join(home, 'current'));
    const described = describeRelease(running, '1.2.3');
    expect(described.path).toBe(running);
    expect(described.sha).toBe(runningSha);
  });
});

describe('resolving the source', () => {
  it('resolves a branch of a local git repository', () => {
    const src = join(tmpDir(), 'src');
    const sha = initRepo(src);
    expect(resolveRemoteSha(src, 'main')).toBe(sha);
  });

  it('resolves a tag to the commit it points at', () => {
    const src = join(tmpDir(), 'src');
    const sha = initRepo(src);
    execFileSync('git', ['-C', src, 'tag', '-a', 'v1', '-m', 'v1'], { encoding: 'utf8' });
    expect(resolveRemoteSha(src, 'v1')).toBe(sha);
  });

  it('resolves a ref that is already a commit to itself', () => {
    const src = join(tmpDir(), 'src');
    const sha = initRepo(src);
    expect(resolveRemoteSha(src, sha)).toBe(sha);
  });

  it('throws for a ref the source does not have', () => {
    const src = join(tmpDir(), 'src');
    initRepo(src);
    expect(() => resolveRemoteSha(src, 'nope')).toThrow();
  });
});

describe('the update check', () => {
  const release = (): { root: string; sha: string } => {
    const root = join(tmpDir(), '20260101-120000-aaaaaaaaaa');
    return { root, sha: initRepo(root) };
  };

  it('reports an update when the source is ahead, with both commits', () => {
    const { root, sha } = release();
    const checker = createUpdateChecker({
      daemon: daemon({ source: '/src', ref: 'main' }), version: '1.0.0', releaseRoot: root,
      resolveRemote: () => 'f'.repeat(40),
    });
    const status = checker.check();
    expect(status).toMatchObject({ configured: true, updateAvailable: true, source: '/src', ref: 'main', targetSha: 'f'.repeat(40), error: null });
    expect(status.running.sha).toBe(sha);
    expect(status.checkedAt).not.toBeNull();
  });

  it('reports no update when the source matches, and still reports both commits', () => {
    const { root, sha } = release();
    const checker = createUpdateChecker({
      daemon: daemon({ source: '/src', ref: 'main' }), version: '1.0.0', releaseRoot: root,
      resolveRemote: () => sha,
    });
    const status = checker.check();
    expect(status.updateAvailable).toBe(false);
    expect(status.targetSha).toBe(sha);
    expect(status.running.sha).toBe(sha);
  });

  it('reports the reason and no update when the source cannot be reached', () => {
    const { root, sha } = release();
    const checker = createUpdateChecker({
      daemon: daemon({ source: '/src', ref: 'main' }), version: '1.0.0', releaseRoot: root,
      resolveRemote: () => { throw new Error('could not read from remote'); },
    });
    const status = checker.check();
    expect(status.updateAvailable).toBe(false);
    expect(status.error).toContain('could not read from remote');
    expect(status.running.sha).toBe(sha);
  });

  it('reports "not configured" — no update, no error, no resolution — when there is no source', () => {
    const { root } = release();
    let resolved = 0;
    const checker = createUpdateChecker({
      daemon: daemon({}), version: '1.0.0', releaseRoot: root,
      resolveRemote: () => { resolved += 1; return 'f'.repeat(40); },
    });
    const status = checker.check();
    expect(status).toMatchObject({ configured: false, updateAvailable: false, error: null, targetSha: null, source: null, ref: null, checkedAt: null });
    expect(resolved).toBe(0);
  });

  it('resolves the source once for two reads inside the caching interval', () => {
    const { root } = release();
    let resolved = 0;
    let clock = 1_000_000;
    const checker = createUpdateChecker({
      daemon: daemon({ source: '/src', ref: 'main', updateCheckIntervalSec: 900 }), version: '1.0.0', releaseRoot: root,
      now: () => clock, resolveRemote: () => { resolved += 1; return 'f'.repeat(40); },
    });
    const first = checker.check();
    clock += 60_000;
    const second = checker.check();
    expect(resolved).toBe(1);
    expect(second.checkedAt).toBe(first.checkedAt);
  });

  it('resolves again and advances the check time on an explicit refresh', () => {
    const { root } = release();
    let resolved = 0;
    let clock = 1_000_000;
    const checker = createUpdateChecker({
      daemon: daemon({ source: '/src', ref: 'main', updateCheckIntervalSec: 900 }), version: '1.0.0', releaseRoot: root,
      now: () => clock, resolveRemote: () => { resolved += 1; return 'f'.repeat(40); },
    });
    const first = checker.check();
    clock += 60_000;
    const refreshed = checker.check({ refresh: true });
    expect(resolved).toBe(2);
    expect(refreshed.checkedAt).not.toBe(first.checkedAt);
  });

  it('resolves again once the caching interval has passed', () => {
    const { root } = release();
    let resolved = 0;
    let clock = 1_000_000;
    const checker = createUpdateChecker({
      daemon: daemon({ source: '/src', ref: 'main', updateCheckIntervalSec: 10 }), version: '1.0.0', releaseRoot: root,
      now: () => clock, resolveRemote: () => { resolved += 1; return 'f'.repeat(40); },
    });
    checker.check();
    clock += 11_000;
    checker.check();
    expect(resolved).toBe(2);
  });
});
