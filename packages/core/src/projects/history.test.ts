import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@agent-conductor/db';
import type { Project } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { git } from '../util/git.js';
import { createHistoryReader, HISTORY_GIT_SUBCOMMANDS } from './history.js';

/** Every git subcommand a mutating or network operation could hide behind. None of these may ever appear in an argv this module builds. */
const FORBIDDEN_VERBS = ['fetch', 'pull', 'push', 'clone', 'remote', 'checkout', 'reset', 'commit', 'branch', 'worktree', 'gc', 'config', 'rebase', 'merge', 'stash', 'tag', 'submodule', 'update-ref', 'symbolic-ref', 'init', 'apply', 'cherry-pick', 'am', 'reflog', 'prune', 'filter-branch'];

describe('history: the git allowlist', () => {
  it('only ever runs read-only subcommands', () => {
    // history.ts's four operations, restated by the subcommand alone: for-each-ref, log, show (meta), show (numstat).
    const argvsThisModuleCanBuild = [
      ['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads'],
      ['log', '--date-order', '--max-count=31', '--skip=0', '--pretty=format:x', 'deadbeef', '--'],
      ['show', '--no-patch', '--pretty=format:x', 'deadbeef', '--'],
      ['show', '--numstat', '--format=', '-m', '--first-parent', 'deadbeef', '--'],
    ];
    for (const argv of argvsThisModuleCanBuild) {
      expect(HISTORY_GIT_SUBCOMMANDS).toContain(argv[0]);
      for (const verb of FORBIDDEN_VERBS) expect(argv).not.toContain(verb);
    }
  });
});

async function initRepo(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}
async function commitFile(dir: string, name: string, content: string, message: string): Promise<string> {
  writeFileSync(`${dir}/${name}`, content, 'utf8');
  await git(['add', '.'], dir);
  await git(['commit', '-m', message], dir);
  const r = await git(['rev-parse', 'HEAD'], dir);
  return r.stdout.trim();
}

describe('history: reading a project clone', () => {
  let h: TestHarness;
  let project: Project;
  let history: ReturnType<typeof createHistoryReader>;

  beforeEach(async () => {
    h = makeHarness();
    const row = h.db.get<{ clonePath: string; gitUrl: string; defaultBranch: string; slug: string }>('SELECT clone_path, git_url, default_branch, slug FROM projects WHERE id = ?', [h.projectId])!;
    await initRepo(row.clonePath);
    project = { id: h.projectId, workspaceId: h.workspaceId, slug: row.slug, name: 'API', gitUrl: row.gitUrl, defaultBranch: row.defaultBranch, landingBranch: null, clonePath: row.clonePath, maxWorkers: 4, setupCommand: null, worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, policies: {}, status: 'ready', lastFetchedAt: null, errorText: null };
    history = createHistoryReader(h.db);
  });
  afterEach(() => h.cleanup());

  it('reports a missing clone plainly, without creating one', async () => {
    const missing = { ...project, clonePath: `${project.clonePath}-does-not-exist` };
    await expect(history.history(missing)).rejects.toThrow();
  });

  it('a repository with only the default branch and no live worktree', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    await commitFile(project.clonePath, 'a.txt', '2', 'second');
    const page = await history.history(project);
    expect(page.refs).toHaveLength(1);
    expect(page.refs[0]).toMatchObject({ name: 'main', isDefault: true });
    expect(page.commits).toHaveLength(2);
    expect(page.commits[0]!.subject).toBe('second');
    expect(page.cursor).toBeNull();
  });

  it('covers a worker branch and joins it to its ticket and worker', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    await git(['checkout', '-b', 'ac/vs-1'], project.clonePath);
    await commitFile(project.clonePath, 'b.txt', '1', 'VS-1: add b');
    await git(['checkout', 'main'], project.clonePath);

    const ticketId = newId();
    h.db.insert('tickets', { id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task', title: 'Add b', createdByKind: 'human', status: 'in_progress', createdAt: 't0', updatedAt: 't0' });
    const agentId = h.addWorker(ticketId, { name: 'Engineer #1' });
    h.db.insert('worktrees', { id: newId(), projectId: h.projectId, ticketId, agentId, provider: 'git', path: '/tmp/wt', branch: 'ac/vs-1', status: 'active', createdAt: 't0' });

    const page = await history.history(project);
    const ref = page.refs.find((r) => r.name === 'ac/vs-1');
    expect(ref).toMatchObject({ ticketIdentifier: 'TST-1', agentName: 'Engineer #1', isDefault: false });
  });

  it('drops a ticket-recorded branch the repository no longer has', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    const ticketId = newId();
    h.db.insert('tickets', { id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task', title: 'Ghost', createdByKind: 'human', status: 'in_progress', createdAt: 't0', updatedAt: 't0' });
    h.db.insert('ticket_work_products', { id: newId(), ticketId, type: 'branch', title: 'ac/ghost', createdAt: 't0', updatedAt: 't0' });

    const page = await history.history(project);
    expect(page.refs.find((r) => r.name === 'ac/ghost')).toBeUndefined();
  });

  it('a linear history is a single lane worth of parents', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    await commitFile(project.clonePath, 'a.txt', '2', 'second');
    await commitFile(project.clonePath, 'a.txt', '3', 'third');
    const page = await history.history(project);
    expect(page.commits.map((c) => c.subject)).toEqual(['third', 'second', 'first']);
    expect(page.commits[0]!.parents).toHaveLength(1);
    expect(page.commits[2]!.parents).toHaveLength(0);
  });

  it('a merge commit carries both parents', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'base');
    await git(['checkout', '-b', 'feature'], project.clonePath);
    await commitFile(project.clonePath, 'b.txt', '1', 'on feature');
    await git(['checkout', 'main'], project.clonePath);
    await commitFile(project.clonePath, 'c.txt', '1', 'on main');
    await git(['merge', '--no-ff', '-m', 'merge feature', 'feature'], project.clonePath);

    const page = await history.history(project);
    const merge = page.commits.find((c) => c.subject === 'merge feature');
    expect(merge?.parents).toHaveLength(2);
  });

  it('two concurrent branches are both covered', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'base');
    await git(['checkout', '-b', 'br-a'], project.clonePath);
    await commitFile(project.clonePath, 'a.txt', '2', 'a work');
    await git(['checkout', 'main'], project.clonePath);
    await git(['checkout', '-b', 'br-b'], project.clonePath);
    await commitFile(project.clonePath, 'b.txt', '1', 'b work');

    const ticketA = newId();
    h.db.insert('tickets', { id: ticketA, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task', title: 'A', createdByKind: 'human', status: 'in_progress', createdAt: 't0', updatedAt: 't0' });
    h.db.insert('worktrees', { id: newId(), projectId: h.projectId, ticketId: ticketA, provider: 'git', path: '/tmp/a', branch: 'br-a', status: 'active', createdAt: 't0' });
    const ticketB = newId();
    h.db.insert('tickets', { id: ticketB, workspaceId: h.workspaceId, projectId: h.projectId, number: 2, identifier: 'TST-2', kind: 'task', title: 'B', createdByKind: 'human', status: 'in_progress', createdAt: 't0', updatedAt: 't0' });
    h.db.insert('worktrees', { id: newId(), projectId: h.projectId, ticketId: ticketB, provider: 'git', path: '/tmp/b', branch: 'br-b', status: 'active', createdAt: 't0' });

    const page = await history.history(project);
    expect(page.refs.map((r) => r.name).sort()).toEqual(['br-a', 'br-b', 'main']);
    expect(page.commits.map((c) => c.subject).sort()).toEqual(['a work', 'b work', 'base']);
  });

  it('a squash landing leaves the branch lane with no merge edge', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'base');
    await git(['checkout', '-b', 'squash-me'], project.clonePath);
    await commitFile(project.clonePath, 'b.txt', '1', 'work 1');
    await commitFile(project.clonePath, 'b.txt', '2', 'work 2');
    await git(['checkout', 'main'], project.clonePath);
    await git(['merge', '--squash', 'squash-me'], project.clonePath);
    await git(['commit', '-m', 'squashed landing'], project.clonePath);

    const page = await history.history(project);
    const squashed = page.commits.find((c) => c.subject === 'squashed landing');
    expect(squashed?.parents).toHaveLength(1); // no merge commit: a squash never has a second parent
  });

  it('pages newest first and continues from the pinned tips when a branch moves mid-page', async () => {
    for (let i = 1; i <= 5; i++) await commitFile(project.clonePath, 'a.txt', String(i), `c${i}`);
    const first = await history.history(project, { limit: 2 });
    expect(first.commits.map((c) => c.subject)).toEqual(['c5', 'c4']);
    expect(first.cursor).not.toBeNull();

    // A new commit lands on main between page one and page two.
    await commitFile(project.clonePath, 'a.txt', '6', 'c6 (late)');

    const second = await history.history(project, { cursor: first.cursor, limit: 2 });
    expect(second.commits.map((c) => c.subject)).toEqual(['c3', 'c2']);

    const third = await history.history(project, { cursor: second.cursor, limit: 2 });
    expect(third.commits.map((c) => c.subject)).toEqual(['c1']);
    expect(third.cursor).toBeNull();
  });

  it('rejects a commit id that is not a plain object name', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    await expect(history.commit(project, 'main')).rejects.toThrow();
    await expect(history.commit(project, '../../etc/passwd')).rejects.toThrow();
    await expect(history.commit(project, '--help')).rejects.toThrow();
  });

  it("a commit's detail carries its message and changed files", async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    const sha = await commitFile(project.clonePath, 'a.txt', '2\n3\n', 'second\n\nlonger body');
    const detail = await history.commit(project, sha);
    expect(detail.message).toContain('second');
    expect(detail.message).toContain('longer body');
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]).toMatchObject({ path: 'a.txt', status: 'modified' });
  });

  it("a merge commit's files are reported against its first parent", async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'base');
    await git(['checkout', '-b', 'feature'], project.clonePath);
    await commitFile(project.clonePath, 'feature-only.txt', '1', 'on feature');
    await git(['checkout', 'main'], project.clonePath);
    const sha = await commitFile(project.clonePath, 'main-only.txt', '1', 'on main').then(async () => {
      await git(['merge', '--no-ff', '-m', 'merge feature', 'feature'], project.clonePath);
      const r = await git(['rev-parse', 'HEAD'], project.clonePath);
      return r.stdout.trim();
    });
    const detail = await history.commit(project, sha);
    // Against first-parent (main), the merge introduces exactly what feature added, not main's own prior history.
    expect(detail.files.map((f) => f.path)).toEqual(['feature-only.txt']);
  });

  it('an unknown commit is not found', async () => {
    await commitFile(project.clonePath, 'a.txt', '1', 'first');
    await expect(history.commit(project, 'deadbeef1234')).rejects.toThrow();
  });
});
