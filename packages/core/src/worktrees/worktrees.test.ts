import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorktreeProvider } from './git.js';
import { landedWorkTest, unlandedCommitCount } from './landed.js';
import { renderWtConfig } from './wtconfig.js';
import { git } from '../util/git.js';
import { projectKeyFromUrl } from '../util/git.js';

const tmps: string[] = [];
function tmpDir(prefix = 'ac-wt-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

async function initRepo(): Promise<string> {
  const dir = tmpDir();
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['config', 'commit.gpgsign', 'false'], dir);
  writeFileSync(join(dir, 'README.md'), '# repo\n', 'utf8');
  await git(['add', '.'], dir);
  await git(['commit', '-m', 'init'], dir);
  return dir;
}

async function commit(repo: string, file: string, body: string, message: string): Promise<void> {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), body, 'utf8');
  await git(['add', '.'], repo);
  await git(['commit', '-m', message], repo);
}

describe('git worktree provider', () => {
  it('creates a worktree on a new branch, lists it and removes it with the branch', async () => {
    const repo = await initRepo();
    const provider = new GitWorktreeProvider();
    expect((await provider.detect()).available).toBe(true);

    const target = join(tmpDir(), 'worker', 'work');
    const info = await provider.create({ repoPath: repo, branch: 'ac/tst-1-demo', base: 'main', targetPath: target });
    expect(info.path).toBe(target);
    expect(existsSync(join(target, 'README.md'))).toBe(true);

    const list = await provider.list(repo);
    expect(list.map((w) => w.branch)).toContain('ac/tst-1-demo');

    await provider.remove({ repoPath: repo, path: target, branch: 'ac/tst-1-demo', deleteBranch: true, force: false });
    expect(existsSync(target)).toBe(false);
    const branches = await git(['branch', '--list', 'ac/tst-1-demo'], repo);
    expect(branches.stdout.trim()).toBe('');
  });

  it('runs the setup command and copies warm paths', async () => {
    const repo = await initRepo();
    mkdirSync(join(repo, 'node_modules'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'cached.txt'), 'warm', 'utf8');
    const target = join(tmpDir(), 'work');
    const provider = new GitWorktreeProvider();
    await provider.create({ repoPath: repo, branch: 'ac/tst-2-warm', base: 'main', targetPath: target, setupCommand: 'echo ready > setup.txt', warmPaths: ['node_modules'] });
    expect(existsSync(join(target, 'setup.txt'))).toBe(true);
    expect(existsSync(join(target, 'node_modules', 'cached.txt'))).toBe(true);
  });

  it('refuses to remove a dirty worktree without force', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    const provider = new GitWorktreeProvider();
    await provider.create({ repoPath: repo, branch: 'ac/tst-3-dirty', base: 'main', targetPath: target });
    writeFileSync(join(target, 'scratch.txt'), 'unsaved', 'utf8');
    await expect(provider.remove({ repoPath: repo, path: target, branch: 'ac/tst-3-dirty', deleteBranch: false, force: false })).rejects.toThrow();
    expect(existsSync(target)).toBe(true);
  });
});

describe('landed-work test', () => {
  it('never counts uncommitted changes as landed', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-4', base: 'main', targetPath: target });
    writeFileSync(join(target, 'wip.txt'), 'in progress', 'utf8');
    const v = await landedWorkTest({ repoPath: repo, worktreePath: target, branch: 'ac/tst-4', landingBranch: 'main', mergedPr: true });
    expect(v.landed).toBe(false);
    expect(v.reason).toMatch(/uncommitted/);
  });

  it('lands when every commit is reachable from a remote-tracking branch', async () => {
    const origin = tmpDir();
    await git(['init', '--bare', '-b', 'main'], origin);
    const seed = await initRepo();
    await git(['remote', 'add', 'origin', origin], seed);
    await git(['push', 'origin', 'main'], seed);

    const clone = join(tmpDir(), 'clone');
    await git(['clone', origin, clone], tmpdir());
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);

    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: clone, branch: 'ac/tst-5', base: 'main', targetPath: target });
    await commit(target, 'feature.txt', 'done', 'feat: add feature');

    const before = await landedWorkTest({ repoPath: clone, worktreePath: target, branch: 'ac/tst-5', landingBranch: 'main' });
    expect(before.landed).toBe(false);
    expect(before.reason).toMatch(/not on any remote/);

    await git(['push', 'origin', 'ac/tst-5'], target);
    const after = await landedWorkTest({ repoPath: clone, worktreePath: target, branch: 'ac/tst-5', landingBranch: 'main' });
    expect(after.landed).toBe(true);
    expect(after.reason).toMatch(/remote-tracking/);
  });

  it('lands when the default branch contains the branch (ancestor) in local-branch mode', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-6', base: 'main', targetPath: target });
    await commit(target, 'a.txt', 'a', 'feat: a');
    await git(['merge', '--ff-only', 'ac/tst-6'], repo);
    const v = await landedWorkTest({ repoPath: repo, worktreePath: target, branch: 'ac/tst-6', landingBranch: 'main', localBranch: true });
    expect(v.landed).toBe(true);
    expect(v.reason).toMatch(/ancestor/);
  });

  it('lands on a patch-id match (squash merge) when the PR is merged', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-7', base: 'main', targetPath: target });
    await commit(target, 'squashed.txt', 'content\n', 'feat: squashed work');
    const sha = (await git(['rev-parse', 'HEAD'], target)).stdout.trim();
    // same patch on main under a different commit (squash-merge shape): patch-id matches, sha does not
    await git(['cherry-pick', '--no-commit', sha], repo);
    await git(['commit', '-m', 'feat: squashed work (#12)'], repo);
    const v = await landedWorkTest({ repoPath: repo, worktreePath: target, branch: 'ac/tst-7', landingBranch: 'main', mergedPr: true });
    expect(v.landed).toBe(true);
    expect(v.reason).toMatch(/equivalent patch/);
  });

  it('refuses when the branch is not contained anywhere', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-8', base: 'main', targetPath: target });
    await commit(target, 'unmerged.txt', 'x', 'feat: unmerged');
    const v = await landedWorkTest({ repoPath: repo, worktreePath: target, branch: 'ac/tst-8', landingBranch: 'main', mergedPr: true });
    expect(v.landed).toBe(false);
    expect(v.evidence.commitsNotInBase).toBe(1);
  });

  it('treats an already-absent worktree as landed', async () => {
    const repo = await initRepo();
    const v = await landedWorkTest({ repoPath: repo, worktreePath: join(repo, 'nope'), branch: 'ac/tst-9', landingBranch: 'main' });
    expect(v.landed).toBe(true);
  });

  it("lands against an effective landing branch other than the repo's default branch (VS-119)", async () => {
    const repo = await initRepo();
    await git(['checkout', '-b', 'edge'], repo);
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-10', base: 'edge', targetPath: target });
    await commit(target, 'a.txt', 'a', 'feat: a');
    await git(['merge', '--ff-only', 'ac/tst-10'], repo);

    // Landed on `edge`, the effective landing branch — even though `main` never received the work.
    const onEdge = await landedWorkTest({ repoPath: repo, worktreePath: target, branch: 'ac/tst-10', landingBranch: 'edge', localBranch: true });
    expect(onEdge.landed).toBe(true);
    expect(onEdge.reason).toMatch(/ancestor/);

    const onDefault = await landedWorkTest({ repoPath: repo, worktreePath: target, branch: 'ac/tst-10', landingBranch: 'main', localBranch: true });
    expect(onDefault.landed).toBe(false);
  });
});

describe('unlandedCommitCount (VS-215 task-done gate)', () => {
  it('counts commits the landing branch does not contain', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-11', base: 'main', targetPath: target });
    await commit(target, 'a.txt', 'a', 'feat: a');
    await commit(target, 'b.txt', 'b', 'feat: b');
    expect(await unlandedCommitCount({ repoPath: repo, worktreePath: target, branch: 'ac/tst-11', landingBranch: 'main' })).toBe(2);
  });

  it('counts 0 for an ancestor branch or a worktree with no new commits', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-12', base: 'main', targetPath: target });
    expect(await unlandedCommitCount({ repoPath: repo, worktreePath: target, branch: 'ac/tst-12', landingBranch: 'main' })).toBe(0);
    await commit(target, 'a.txt', 'a', 'feat: a');
    await git(['merge', '--ff-only', 'ac/tst-12'], repo);
    expect(await unlandedCommitCount({ repoPath: repo, worktreePath: target, branch: 'ac/tst-12', landingBranch: 'main' })).toBe(0);
  });

  it('counts 0 for a branch whose commits are patch-id equivalent (squash/cherry-pick)', async () => {
    const repo = await initRepo();
    const target = join(tmpDir(), 'work');
    await new GitWorktreeProvider().create({ repoPath: repo, branch: 'ac/tst-13', base: 'main', targetPath: target });
    await commit(target, 'a.txt', 'a', 'feat: a');
    await git(['cherry-pick', 'ac/tst-13'], repo);
    expect(await unlandedCommitCount({ repoPath: repo, worktreePath: target, branch: 'ac/tst-13', landingBranch: 'main' })).toBe(0);
  });

  it('counts 0 when the worktree or the clone is missing, and warns only when git fails', async () => {
    const repo = await initRepo();
    expect(await unlandedCommitCount({ repoPath: repo, worktreePath: join(tmpDir(), 'absent'), branch: 'ac/tst-14', landingBranch: 'main' })).toBe(0);
    expect(await unlandedCommitCount({ repoPath: null, worktreePath: repo, branch: 'main', landingBranch: 'main' })).toBe(0);

    const warns: unknown[] = [];
    // A branch ref git cannot resolve makes both reads fail; the gate fails open, loudly.
    expect(await unlandedCommitCount({ repoPath: repo, worktreePath: repo, branch: 'no-such-branch', landingBranch: 'main' }, { warn: (o) => warns.push(o) })).toBe(0);
    expect(warns.length).toBe(1);
  });
});

describe('worktrunk config generation', () => {
  it('writes one project block per repo with warm and setup pre-start hooks', () => {
    const toml = renderWtConfig([
      { url: 'git@github.com:acme/api.git', defaultBranch: 'main', setupCommand: 'pnpm install' },
      { url: 'https://gitlab.com/acme/web.git', defaultBranch: 'trunk' },
    ]);
    expect(toml).toContain('[list]\njson-schema = 2');
    expect(toml).toContain('[projects."github.com/acme/api"]');
    expect(toml).toContain('warm = "wt step copy-ignored --from main --to \'{{ branch }}\'"');
    expect(toml).toContain('setup = "pnpm install"');
    expect(toml).toContain('[projects."gitlab.com/acme/web"]');
    expect(toml).toContain('--from trunk');
  });

  it('derives the worktrunk project key from every url shape', () => {
    expect(projectKeyFromUrl('git@github.com:acme/api.git')).toBe('github.com/acme/api');
    expect(projectKeyFromUrl('https://github.com/acme/api')).toBe('github.com/acme/api');
    expect(projectKeyFromUrl('ssh://git@example.com/acme/api.git')).toBe('example.com/acme/api');
    expect(projectKeyFromUrl('/srv/git/acme/api')).toBe('local/acme/api');
  });
});
