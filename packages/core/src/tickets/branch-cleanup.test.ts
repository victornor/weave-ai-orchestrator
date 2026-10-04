import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { OcError, type Project } from '@weave-ai/shared';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { git } from '../util/git.js';
import type { Actor, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const BRANCH = 'ac/tst-1-add-dark-mode';

/**
 * VS-327: unlike `merge-done.test.ts` (which always pre-merges the PR in its own test setup, the
 * *old* worker-merges contract), these tests exercise the *new* contract — the PR is still open
 * when `mergeDone` is called, and the daemon itself archives the ticket's OpenSpec change onto the
 * branch (when it has one) and performs the merge.
 */
describe('branch cleanup after merge (VS-770)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let dir: string;
  let origin: string;
  let clone: string;
  let openspecArchiveAfterMerge: ReturnType<typeof vi.fn>;
  let requireCi: boolean;
  let policies: Record<string, unknown>;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  beforeEach(async () => {
    requireCi = false;
    policies = {};
    h = makeHarness();
    const wake = fakeWake();
    const decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0), withdrawForTicket: vi.fn(() => 0) };
    openspecArchiveAfterMerge = vi.fn(async () => ({ archivedAs: null, skipped: 'nothing to backfill' }));
    const openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: openspecArchiveAfterMerge,
    };
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.openspec = openspec as never;
    h.services.specs = fakeSpecs() as never;
    h.services.workers = {
      spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })),
      retireIfLanded: vi.fn(async () => ({ retired: true })),
    } as never;

    dir = mkdtempSync(join(tmpdir(), 'ac-merge-lands-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');
    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    await commit(origin, 'README.md', '# api\n', 'init');
    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);

    h.services.projects = {
      get: () => ({
        id: h.projectId, workspaceId: h.workspaceId, slug: 'api', name: 'API', gitUrl: 'git@example.com:acme/api.git',
        defaultBranch: 'main', landingBranch: null, clonePath: clone, maxWorkers: 4, setupCommand: null,
        worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: { deliveryMode: 'pr', requireCi, ...policies },
        status: 'ready', syncState: 'in_sync', primaryCloneSyncedHead: null, lastFetchedAt: null, errorText: null,
      } satisfies Project),
    } as never;

    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });

  afterEach(async () => {
    await tickets.stop();
    h.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A real squash of whatever `origin/<branch>` currently holds onto `origin/main` — what `gh pr merge --squash` does. */
  async function realSquashMerge(branch: string = BRANCH): Promise<{ mergeCommit: string }> {
    await git(['fetch', origin, `${branch}:squash-src-${branch.replace(/[^a-z0-9]+/gi, '-')}`], clone);
    const squashSrc = `squash-src-${branch.replace(/[^a-z0-9]+/gi, '-')}`;
    await git(['checkout', 'main'], clone);
    await git(['merge', '--squash', squashSrc], clone);
    await git(['commit', '-m', `feat: dark mode (#42)`], clone);
    await git(['push', 'origin', 'main'], clone);
    return { mergeCommit: await head(clone) };
  }


  function mergedForge(headSha: string, mergeCommit: string, over: Partial<ForgeAdapter> = {}): ForgeAdapter {
    return {
      id: 'github',
      detect: async () => true,
      prState: vi.fn(async () => ({ state: 'merged' as const, mergeCommit, headSha, ciState: 'none' as const })),
      mergePr: vi.fn(async () => ({ mergeCommit })),
      deleteBranch: vi.fn(async () => undefined),
      pullRequestForBranch: vi.fn(async () => null),
      ...over,
    };
  }

  async function fileMergingTicket(branch = BRANCH, prUrl = 'https://example.com/pr/42'): Promise<string> {
    const t = tickets.create(HUMAN, { kind: 'task', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: prUrl });
    h.db.insert('worktrees', {
      id: newId(), projectId: h.projectId, ticketId: t.id, agentId: null, provider: 'git',
      path: clone, branch, status: 'active', createdAt: nowIso(),
    });
    h.db.update('tickets', t.id, { status: 'merging' });
    return t.id;
  }

  /** Pushes the ticket branch, squash-merges it onto main like `gh pr merge --squash`, and returns the head at merge. */
  async function pushAndSquash(): Promise<{ mergeCommit: string; branchHead: string }> {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    const branchHead = await head(clone);
    await git(['checkout', 'main'], clone);
    const { mergeCommit } = await realSquashMerge();
    return { mergeCommit, branchHead };
  }

  const originHeads = async (): Promise<string> => (await git(['branch', '--list'], origin)).stdout;

  it('deletes the remote and local branch of a squash-merged ticket whose head equals the PR head at merge', async () => {
    const { mergeCommit, branchHead } = await pushAndSquash();
    // Squash: the branch head is not an ancestor of main, so only the forge's head SHA can vouch for it.
    expect((await git(['merge-base', '--is-ancestor', branchHead, 'main'], clone)).ok).toBe(false);
    const ticketId = await fileMergingTicket();
    const forge = mergedForge(branchHead, mergeCommit);
    h.ctx.registries.forges.set('github', forge);

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(forge.deleteBranch).toHaveBeenCalledWith(clone, BRANCH);
    expect((await git(['branch', '--list', BRANCH], clone)).stdout.trim()).toBe('');
  });

  it('keeps a branch that has a commit pushed after the merge', async () => {
    const { mergeCommit, branchHead } = await pushAndSquash();
    await git(['checkout', BRANCH], clone);
    await commit(clone, 'b.ts', 'export const b = 2;\n', 'feat: pushed after merge');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    const ticketId = await fileMergingTicket();
    const forge = mergedForge(branchHead, mergeCommit);
    h.ctx.registries.forges.set('github', forge);

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(forge.deleteBranch).not.toHaveBeenCalled();
    expect(tickets.comments(ticketId).filter((c) => c.body.includes('kept remote branch'))).toHaveLength(1);
  });

  it('accepts an ancestor of the landing branch for a merge-commit project', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    await git(['merge', '--no-ff', '-m', 'merge', BRANCH], clone);
    await git(['push', 'origin', 'main'], clone);
    const mergeCommit = await head(clone);
    const ticketId = await fileMergingTicket();
    // The forge cannot vouch for the head (no headSha), the ancestry rule alone accepts it.
    const forge = mergedForge('', mergeCommit, { prState: vi.fn(async () => ({ state: 'merged' as const, mergeCommit, ciState: 'none' as const })) });
    h.ctx.registries.forges.set('github', forge);

    await tickets.mergeDone(AGENT, ticketId, {});
    expect(forge.deleteBranch).toHaveBeenCalledWith(clone, BRANCH);
  });

  it('deletes nothing when the project turns the policy off', async () => {
    policies = { deleteBranchAfterMerge: false };
    const { mergeCommit, branchHead } = await pushAndSquash();
    const ticketId = await fileMergingTicket();
    const forge = mergedForge(branchHead, mergeCommit);
    h.ctx.registries.forges.set('github', forge);

    await tickets.mergeDone(AGENT, ticketId, {});
    expect(forge.deleteBranch).not.toHaveBeenCalled();
  });

  it('honours the workspace default when the project is silent', async () => {
    h.ctx.config.defaults.deleteBranchAfterMerge = false;
    const { mergeCommit, branchHead } = await pushAndSquash();
    const ticketId = await fileMergingTicket();
    const forge = mergedForge(branchHead, mergeCommit);
    h.ctx.registries.forges.set('github', forge);
    await tickets.mergeDone(AGENT, ticketId, {});
    expect(forge.deleteBranch).not.toHaveBeenCalled();
  });

  it('never deletes the default or landing branch', async () => {
    const { mergeCommit } = await pushAndSquash();
    const mainSha = await head(clone, 'origin/main');
    const ticketId = await fileMergingTicket('main');
    const forge = mergedForge(mainSha, mergeCommit);
    h.ctx.registries.forges.set('github', forge);

    await tickets.mergeDone(AGENT, ticketId, {});
    expect(forge.deleteBranch).not.toHaveBeenCalled();
    expect(await originHeads()).toMatch(/main/);
  });

  it('keeps a branch that is the head of another open pull request', async () => {
    const { mergeCommit, branchHead } = await pushAndSquash();
    const ticketId = await fileMergingTicket();
    const forge = mergedForge(branchHead, mergeCommit, { pullRequestForBranch: vi.fn(async () => ({ url: 'https://example.com/pr/99', number: 99 })) });
    h.ctx.registries.forges.set('github', forge);

    await tickets.mergeDone(AGENT, ticketId, {});
    expect(forge.deleteBranch).not.toHaveBeenCalled();
    expect(tickets.comments(ticketId).some((c) => c.body.includes('open pull request #99'))).toBe(true);
  });

  it('a failed delete is noted once on the ticket and does not fail the landing', async () => {
    const { mergeCommit, branchHead } = await pushAndSquash();
    const ticketId = await fileMergingTicket();
    const forge = mergedForge(branchHead, mergeCommit, { deleteBranch: vi.fn(async () => { throw new Error('HTTP 403 forbidden'); }) });
    h.ctx.registries.forges.set('github', forge);

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(tickets.comments(ticketId).filter((c) => c.body.includes('could not delete remote branch'))).toHaveLength(1);
  });

  describe('pruneBranches', () => {
    async function doneTicketWithBranch(): Promise<{ ticketId: string; mergeCommit: string; branchHead: string }> {
      const { mergeCommit, branchHead } = await pushAndSquash();
      const ticketId = await fileMergingTicket();
      h.db.update('tickets', ticketId, { status: 'done' });
      return { ticketId, mergeCommit, branchHead };
    }

    it('--dry-run lists the squash-merged branch and deletes nothing', async () => {
      const { mergeCommit, branchHead } = await doneTicketWithBranch();
      const forge = mergedForge(branchHead, mergeCommit);
      h.ctx.registries.forges.set('github', forge);

      const r = await tickets.pruneBranches(HUMAN, h.projectId, { dryRun: true });
      expect(r.candidates.map((c) => c.branch)).toEqual([BRANCH]);
      expect(r.deleted).toEqual([]);
      expect(forge.deleteBranch).not.toHaveBeenCalled();
    });

    it('deletes the candidate without --dry-run, and keeps one with a newer commit', async () => {
      const { mergeCommit, branchHead } = await doneTicketWithBranch();
      const forge = mergedForge(branchHead, mergeCommit);
      h.ctx.registries.forges.set('github', forge);
      const r = await tickets.pruneBranches(HUMAN, h.projectId, { dryRun: false });
      expect(r.deleted).toEqual([BRANCH]);
      expect(forge.deleteBranch).toHaveBeenCalledWith(clone, BRANCH);

      // A second ticket whose branch got a commit after its merge is kept.
      const other = 'ac/tst-2-other';
      await git(['checkout', '-b', other, 'main'], clone);
      await commit(clone, 'c.ts', 'export const c = 3;\n', 'feat: c');
      await git(['push', 'origin', other], clone);
      const stale = await head(clone);
      await commit(clone, 'd.ts', 'export const d = 4;\n', 'feat: after merge');
      await git(['push', 'origin', other], clone);
      await git(['checkout', 'main'], clone);
      const t2 = await fileMergingTicket(other, 'https://example.com/pr/43');
      h.db.update('tickets', t2, { status: 'cancelled' });
      (forge.prState as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'merged', mergeCommit, headSha: stale, ciState: 'none' });
      (forge.deleteBranch as ReturnType<typeof vi.fn>).mockClear();
      const r2 = await tickets.pruneBranches(HUMAN, h.projectId, { dryRun: false });
      expect(r2.deleted).toEqual([]);
      expect(r2.kept.some((k) => k.branch === other)).toBe(true);
      expect(forge.deleteBranch).not.toHaveBeenCalled();
    });

    it('never lists a branch whose ticket is still active', async () => {
      const { mergeCommit, branchHead } = await pushAndSquash();
      await fileMergingTicket(); // stays in merging
      const forge = mergedForge(branchHead, mergeCommit);
      h.ctx.registries.forges.set('github', forge);
      const r = await tickets.pruneBranches(HUMAN, h.projectId, { dryRun: true });
      expect(r.candidates).toEqual([]);
    });
  });
});
