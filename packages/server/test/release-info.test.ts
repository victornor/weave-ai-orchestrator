import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { resolveRemoteSha } from '@weave-ai/release';
import { createUpdateChecker, describeRelease, detectStaleSource, releaseOrigin } from '../src/release-info.js';

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

describe('the release origin (VS-830)', () => {
  it('reports the normalized repository a release was built from', () => {
    const root = join(tmpDir(), '20260101-120000-aaaaaaaaaa');
    initRepo(root);
    execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/victornor/old-repo'], { encoding: 'utf8' });
    expect(releaseOrigin(root)).toBe('git@github.com:victornor/old-repo.git');
  });

  it('reports null for a release with no clone, no origin, or no directory at all', () => {
    const plain = join(tmpDir(), 'plain');
    mkdirSync(plain, { recursive: true });
    expect(releaseOrigin(plain)).toBeNull();
    const cloned = join(tmpDir(), '20260101-120000-bbbbbbbbbb');
    initRepo(cloned);
    expect(releaseOrigin(cloned)).toBeNull();
    expect(releaseOrigin(join(tmpDir(), 'gone'))).toBeNull();
  });
});

describe('detecting a stale release source (VS-830)', () => {
  const oldRepo = 'https://github.com/victornor/old-repo';
  const newRepo = 'https://github.com/victornor/new-repo';
  const project = (over: Partial<{ id: string; slug: string; gitUrl: string; clonePath: string; hasCommit: boolean }> = {}) => ({
    id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/clones/api', hasCommit: true, ...over,
  });
  const input = (over: Partial<Parameters<typeof detectStaleSource>[0]> = {}) => ({
    runtimeSource: 'git@github.com:victornor/old-repo.git',
    source: oldRepo,
    runningSha: 'a'.repeat(40),
    projects: [project()],
    containsCommit: (p: { hasCommit?: boolean }) => p.hasCommit !== false,
    ...over,
  });

  it('reports the project the source was left behind by', () => {
    expect(detectStaleSource(input())).toEqual({
      configured: oldRepo,
      project: { id: 'p1', slug: 'api', url: newRepo },
    });
  });

  it('reports nothing once the source names the new repository', () => {
    expect(detectStaleSource(input({ source: newRepo }))).toBeNull();
  });

  it('never reports a source that is an independent choice', () => {
    expect(detectStaleSource(input({ source: 'https://github.com/victornor/third-repo' }))).toBeNull();
  });

  it('reports nothing when no project moved away from the release repository', () => {
    expect(detectStaleSource(input({ projects: [project({ gitUrl: oldRepo })] }))).toBeNull();
  });

  it('reports nothing when the project clone does not carry the running release commit', () => {
    expect(detectStaleSource(input({ projects: [project({ hasCommit: false })] }))).toBeNull();
  });

  it('reports nothing when the running release repository is unknown', () => {
    expect(detectStaleSource(input({ runtimeSource: null }))).toBeNull();
  });

  it('reports nothing when no source is configured', () => {
    expect(detectStaleSource(input({ source: null }))).toBeNull();
  });

  it('picks the first matching project by slug', () => {
    const stale = detectStaleSource(input({
      projects: [project({ id: 'z', slug: 'zebra' }), project({ id: 'a', slug: 'apple' })],
    }));
    expect(stale?.project).toEqual({ id: 'a', slug: 'apple', url: newRepo });
  });
});

describe('the update status carries the stale-source warning (VS-830)', () => {
  const oldRepo = 'https://github.com/victornor/old-repo';
  const newRepo = 'https://github.com/victornor/new-repo';
  const releaseWithOrigin = (origin: string | null): { root: string; sha: string } => {
    const root = join(tmpDir(), '20260101-120000-aaaaaaaaaa');
    const sha = initRepo(root);
    if (origin) execFileSync('git', ['-C', root, 'remote', 'add', 'origin', origin], { encoding: 'utf8' });
    return { root, sha };
  };
  const checkerFor = (o: {
    root: string; source: string; ref?: string;
    resolveRemote?: () => string;
    projects?: Array<{ id: string; slug: string; gitUrl: string; clonePath: string }>;
    containsCommit?: () => boolean;
  }) => createUpdateChecker({
    daemon: daemon({ source: o.source, ref: o.ref ?? 'main' }), version: '1.0.0', releaseRoot: o.root,
    resolveRemote: o.resolveRemote ?? (() => 'f'.repeat(40)),
    staleSources: { projects: () => o.projects ?? [] },
    containsCommit: o.containsCommit ?? (() => true),
  });

  it('reports the running release repository and the mismatch', () => {
    const { root } = releaseWithOrigin(oldRepo);
    const status = checkerFor({ root, source: oldRepo, projects: [{ id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/c' }] }).check();
    expect(status.runtimeSource).toBe('git@github.com:victornor/old-repo.git');
    expect(status.staleSource).toEqual({ configured: oldRepo, project: { id: 'p1', slug: 'api', url: newRepo } });
  });

  it('reports a mismatch even when the stale source resolves to the running commit', () => {
    const { root, sha } = releaseWithOrigin(oldRepo);
    const status = checkerFor({ root, source: oldRepo, resolveRemote: () => sha, projects: [{ id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/c' }] }).check();
    expect(status.updateAvailable).toBe(false);
    expect(status.staleSource).not.toBeNull();
  });

  it('reports a mismatch alongside a failed resolve', () => {
    const { root } = releaseWithOrigin(oldRepo);
    const status = checkerFor({
      root, source: oldRepo, resolveRemote: () => { throw new Error('could not read from remote'); },
      projects: [{ id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/c' }],
    }).check();
    expect(status.error).toContain('could not read from remote');
    expect(status.staleSource).not.toBeNull();
  });

  it('reports no mismatch when the source already names the new repository', () => {
    const { root } = releaseWithOrigin(oldRepo);
    const status = checkerFor({ root, source: newRepo, projects: [{ id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/c' }] }).check();
    expect(status.staleSource).toBeNull();
  });

  it('reports no runtime source when the release has no origin', () => {
    const { root } = releaseWithOrigin(null);
    const status = checkerFor({ root, source: oldRepo, projects: [{ id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/c' }] }).check();
    expect(status.runtimeSource).toBeNull();
    expect(status.staleSource).toBeNull();
  });

  it('reports the mismatch on a cached read too, and after the source changes', () => {
    const { root } = releaseWithOrigin(oldRepo);
    const projects = [{ id: 'p1', slug: 'api', gitUrl: newRepo, clonePath: '/c' }];
    // The live daemon object is mutated in place when the source changes (see the route), so the
    // checker must observe the new value on its next read, cached answer or not.
    const live = daemon({ source: oldRepo, ref: 'main', updateCheckIntervalSec: 900 });
    const checker = createUpdateChecker({
      daemon: live,
      version: '1.0.0', releaseRoot: root,
      resolveRemote: () => 'f'.repeat(40),
      staleSources: { projects: () => projects },
      containsCommit: () => true,
    });
    expect(checker.check().staleSource).not.toBeNull();
    expect(checker.check().staleSource).not.toBeNull();
    // Mutate the object the checker holds, exactly as `PATCH /api/daemon/update/source` does.
    live.upgrade.source = newRepo;
    expect(checker.check().staleSource).toBeNull();
  });

  it('invalidates the cached answer', () => {
    const { root } = releaseWithOrigin(oldRepo);
    let resolved = 0;
    let clock = 1_000_000;
    const checker = createUpdateChecker({
      daemon: daemon({ source: oldRepo, ref: 'main', updateCheckIntervalSec: 900 }), version: '1.0.0', releaseRoot: root,
      now: () => clock, resolveRemote: () => { resolved += 1; return 'f'.repeat(40); },
    });
    checker.check();
    checker.invalidate();
    clock += 1_000;
    const second = checker.check();
    expect(resolved).toBe(2);
    expect(second.checkedAt).not.toBeNull();
  });
});
