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
describe('mergeDone lands an open PR itself (VS-327)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let dir: string;
  let origin: string;
  let clone: string;
  let openspecArchiveAfterMerge: ReturnType<typeof vi.fn>;
  let requireCi: boolean;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  beforeEach(async () => {
    requireCi = false;
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
        worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: { deliveryMode: 'pr', requireCi },
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

  function openPrForge(over: Partial<ForgeAdapter> = {}): ForgeAdapter {
    return {
      id: 'github',
      detect: async () => true,
      prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const })),
      mergePr: vi.fn(async () => {
        const { mergeCommit } = await realSquashMerge();
        return { mergeCommit };
      }),
      ...over,
    };
  }

  /** Like `openPrForge`, but its `mergePr` squashes a specific branch — for a multi-ticket test. */
  function forgeFor(branch: string): ForgeAdapter {
    return openPrForge({
      mergePr: vi.fn(async () => {
        const { mergeCommit } = await realSquashMerge(branch);
        return { mergeCommit };
      }),
    });
  }

  async function fileMergingTicket(
    kind: 'change' | 'task' = 'change',
    openspecChangeName?: string | null,
    opts: { branch?: string; prUrl?: string } = {},
  ): Promise<string> {
    const t = tickets.create(HUMAN, { kind, title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId });
    if (openspecChangeName !== undefined) h.db.update('tickets', t.id, { openspecChangeName });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: opts.prUrl ?? 'https://example.com/pr/42' });
    h.db.insert('worktrees', {
      id: newId(), projectId: h.projectId, ticketId: t.id, agentId: null, provider: 'git',
      path: clone, branch: opts.branch ?? BRANCH, status: 'active', createdAt: nowIso(),
    });
    h.db.update('tickets', t.id, { status: 'merging' });
    return t.id;
  }

  it('archives the ticket\'s change onto the branch and merges it itself when the PR is still open', async () => {
    // The base spec exists on `main` before the ticket branches — a real change's delta always
    // targets specs main already has.
    mkdirSync(join(clone, 'openspec', 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(clone, 'openspec', 'specs', 'widgets', 'spec.md'), '# widgets Specification\n\n## Purpose\nWidgets exist for this end-to-end mergeDone test, at least fifty characters.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n');
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: add widgets spec'], clone);
    await git(['push', 'origin', 'main'], clone);

    // The ticket's branch forks from that base, adds code, and its own (unarchived) change folder.
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    const changeDir = join(clone, 'openspec', 'changes', 'add-dark-mode');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nTest.\n\n## What Changes\n- Add a scenario.\n\n## Capabilities\n\n### Modified Capabilities\n- `widgets`: adds a scenario\n');
    mkdirSync(join(changeDir, 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(changeDir, 'specs', 'widgets', 'spec.md'), '## MODIFIED Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget, and it SHALL be dark-mode aware.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n\n#### Scenario: Dark mode\n- **WHEN** dark mode is on\n- **THEN** the widget is dark-mode aware\n');
    writeFileSync(join(changeDir, 'tasks.md'), '## 1. Dark mode\n\n- [x] 1.1 Support it\n');
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'feat: propose dark mode'], clone);
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    const ticketId = await fileMergingTicket('change', 'add-dark-mode');

    const forge = openPrForge();
    h.ctx.registries.forges.set('github', forge);

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(forge.mergePr).toHaveBeenCalledTimes(1);
    // One commit on main carries the code and the archive together.
    const finalLog = await git(['log', '--oneline', 'main'], clone);
    const commitCount = finalLog.stdout.trim().split('\n').length;
    expect(commitCount).toBe(3); // init, seed, and the one squash commit carrying code + archive
    const spec = (await git(['show', 'main:openspec/specs/widgets/spec.md'], clone)).stdout;
    expect(spec).toMatch(/dark-mode aware/);
    // The change folder moved to the archive, on that same one commit — the path no longer exists
    // at its pre-archive location once the archive commit is on `main`.
    const preArchivePath = ['openspec', 'changes', 'add-dark-mode'].join('/');
    const stillThere = await git(['cat-file', '-e', `main:${preArchivePath}`], clone);
    expect(stillThere.ok).toBe(false);
    // The ticket reports the archive the new flow itself performed, and never falls back to the
    // old post-merge, direct-push-to-`main` archive path (VS-327 task 3.1).
    expect(next.delivery).toMatchObject({ archivedAs: expect.stringContaining('add-dark-mode') });
    expect(openspecArchiveAfterMerge).not.toHaveBeenCalled();
  });

  it('merges directly with no archive step when the ticket carries no OpenSpec change', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    const ticketId = await fileMergingTicket('task', null);

    const forge = openPrForge();
    h.ctx.registries.forges.set('github', forge);

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(forge.mergePr).toHaveBeenCalledTimes(1);
    expect(openspecArchiveAfterMerge).not.toHaveBeenCalled();
  });

  describe('a bound change that does not exist (VS-787)', () => {
    async function branchWithoutChange(): Promise<void> {
      await git(['checkout', '-b', BRANCH], clone);
      await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
      await git(['push', 'origin', BRANCH], clone);
      await git(['checkout', 'main'], clone);
    }

    it('lands a task ticket and notes that the archive was skipped', async () => {
      await branchWithoutChange();
      const ticketId = await fileMergingTicket('task', 'fix-the-thing');
      const forge = openPrForge();
      h.ctx.registries.forges.set('github', forge);

      const next = await tickets.mergeDone(AGENT, ticketId, {});
      expect(next.status).toBe('done');
      expect(forge.mergePr).toHaveBeenCalledTimes(1);
      expect(tickets.comments(ticketId).filter((c) => c.body === 'no OpenSpec change; archive skipped')).toHaveLength(1);
      expect(openspecArchiveAfterMerge).not.toHaveBeenCalled();
    });

    it('still blocks a change ticket', async () => {
      await branchWithoutChange();
      const ticketId = await fileMergingTicket('change', 'fix-the-thing');
      const forge = openPrForge();
      h.ctx.registries.forges.set('github', forge);

      await expect(tickets.mergeDone(AGENT, ticketId, {})).rejects.toMatchObject({ code: 'openspec_archive_blocked' });
      expect(forge.mergePr).not.toHaveBeenCalled();
      expect(tickets.comments(ticketId).some((c) => c.body === 'no OpenSpec change; archive skipped')).toBe(false);
    });
  });

  it('still uses the old archive path for a PR merged out of band', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    const ticketId = await fileMergingTicket('task', null);
    const { mergeCommit } = await realSquashMerge();

    const forge = openPrForge({ prState: vi.fn(async () => ({ state: 'merged' as const, mergeCommit, ciState: 'none' as const })) });
    h.ctx.registries.forges.set('github', forge);

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(openspecArchiveAfterMerge).toHaveBeenCalledTimes(1);
  });

  it('rejects the landing request on a real conflict, without merging', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    await commit(origin, 'a.ts', 'export const a = 999;\n', 'feat: conflicting change landed first');
    const ticketId = await fileMergingTicket('task', null);

    const forge = openPrForge();
    h.ctx.registries.forges.set('github', forge);

    await expect(tickets.mergeDone(AGENT, ticketId, {})).rejects.toMatchObject({ code: 'merge_unverified' });
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.get(ticketId).status).toBe('merging');
    // A durable trail for anyone reviewing the ticket later, even though the worker already learns
    // of the failure synchronously from this call's own rejection (task 2.7).
    expect(tickets.comments(ticketId).some((c) => c.body.includes('conflicts'))).toBe(true);
  });

  it('blocks the merge entirely when archiving fails (acceptance #2)', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    // No openspec directory at all on the branch: `openspec archive` has nothing to archive and fails.
    const ticketId = await fileMergingTicket('change', 'add-dark-mode');

    const forge = openPrForge();
    h.ctx.registries.forges.set('github', forge);

    await expect(tickets.mergeDone(AGENT, ticketId, {})).rejects.toThrow();
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.get(ticketId).status).toBe('merging');
    // Nothing landed on main.
    expect((await git(['log', '--oneline', 'main'], clone)).stdout.trim().split('\n').length).toBe(1);
    expect(tickets.comments(ticketId).some((c) => c.body.includes('landing failed'))).toBe(true);
  });

  it('rejects checks_pending without merging', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    const ticketId = await fileMergingTicket('task', null);

    const forge = openPrForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'pending' as const })) });
    h.ctx.registries.forges.set('github', forge);

    await expect(tickets.mergeDone(AGENT, ticketId, {})).rejects.toMatchObject({ code: 'merge_checks_pending', retryable: true });
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.get(ticketId).status).toBe('merging');
  });

  it('lands a repository with no workflows and an empty rollup on the first call, and says why on the ticket (VS-768)', async () => {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
    requireCi = true; // the project default
    const ticketId = await fileMergingTicket('task', null);

    const forge = openPrForge({ hasCiWorkflows: vi.fn(async () => false), markPullRequestReady: vi.fn(async () => ({ changed: true })) });
    h.ctx.registries.forges.set('github', forge);

    await tickets.mergeDone(AGENT, ticketId, {});
    expect(forge.mergePr).toHaveBeenCalledTimes(1);
    expect(tickets.get(ticketId).status).toBe('done');
    expect(tickets.comments(ticketId).filter((c) => c.body === 'landed without CI because the repository has no GitHub Actions workflows')).toHaveLength(1);
  });

  it('lands two tickets touching the same capability back to back, each archiving against the other\'s state (acceptance #3)', async () => {
    mkdirSync(join(clone, 'openspec', 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(clone, 'openspec', 'specs', 'widgets', 'spec.md'), '# widgets Specification\n\n## Purpose\nWidgets exist for this two-ticket end-to-end test, at least fifty characters long.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n');
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: add widgets spec'], clone);
    await git(['push', 'origin', 'main'], clone);
    const baseHead = await head(clone, 'main');

    function addedRequirement(changeDir: string, capability: string, requirement: string, scenarioName: string): void {
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
      writeFileSync(join(changeDir, 'proposal.md'), `## Why\nTest.\n\n## What Changes\n- Add ${requirement}.\n\n## Capabilities\n\n### Modified Capabilities\n- \`${capability}\`: adds ${requirement}\n`);
      mkdirSync(join(changeDir, 'specs', capability), { recursive: true });
      writeFileSync(
        join(changeDir, 'specs', capability, 'spec.md'),
        `## ADDED Requirements\n\n### Requirement: ${requirement}\nThe system SHALL support ${requirement.toLowerCase()}.\n\n#### Scenario: ${scenarioName}\n- **WHEN** asked\n- **THEN** it works\n`,
      );
      writeFileSync(join(changeDir, 'tasks.md'), '## 1. Task\n\n- [x] 1.1 Done\n');
    }

    const BRANCH_A = 'ac/tst-2-resize';
    await git(['checkout', '-b', BRANCH_A, baseHead], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    addedRequirement(join(clone, 'openspec', 'changes', 'add-resize'), 'widgets', 'A widget can be resized', 'Resize');
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'feat: propose resize'], clone);
    await git(['push', 'origin', BRANCH_A], clone);

    const BRANCH_B = 'ac/tst-3-rename';
    await git(['checkout', '-b', BRANCH_B, baseHead], clone);
    await commit(clone, 'b.ts', 'export const b = 1;\n', 'feat: b');
    addedRequirement(join(clone, 'openspec', 'changes', 'add-rename'), 'widgets', 'A widget can be renamed', 'Rename');
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'feat: propose rename'], clone);
    await git(['push', 'origin', BRANCH_B], clone);

    await git(['checkout', 'main'], clone);

    const ticketA = await fileMergingTicket('change', 'add-resize', { branch: BRANCH_A, prUrl: 'https://example.com/pr/101' });
    h.ctx.registries.forges.set('github', forgeFor(BRANCH_A));
    const nextA = await tickets.mergeDone(AGENT, ticketA, {});
    expect(nextA.status).toBe('done');

    // Ticket B's branch was cut from the same base as A's, before A landed — it is now stale.
    const ticketB = await fileMergingTicket('change', 'add-rename', { branch: BRANCH_B, prUrl: 'https://example.com/pr/102' });
    h.ctx.registries.forges.set('github', forgeFor(BRANCH_B));
    const nextB = await tickets.mergeDone(AGENT, ticketB, {});
    expect(nextB.status).toBe('done');

    // Both requirements landed — B's archive ran against the spec state A's archive already produced.
    const finalSpec = (await git(['show', 'main:openspec/specs/widgets/spec.md'], clone)).stdout;
    expect(finalSpec).toMatch(/A widget exists/);
    expect(finalSpec).toMatch(/A widget can be resized/);
    expect(finalSpec).toMatch(/A widget can be renamed/);
    // init, the widgets seed, and one squash commit per ticket — no extra commits from a conflict.
    const mainLog = await git(['log', '--oneline', 'main'], clone);
    expect(mainLog.stdout.trim().split('\n')).toHaveLength(4);
  });

  it('a stale branch touching different files lands in one mergeDone call, no worker round-trip (task 2.10)', async () => {
    const baseHead = await head(clone, 'main');

    const BRANCH_A = 'ac/tst-4-a';
    await git(['checkout', '-b', BRANCH_A, baseHead], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', BRANCH_A], clone);

    const BRANCH_B = 'ac/tst-5-b';
    await git(['checkout', '-b', BRANCH_B, baseHead], clone);
    await commit(clone, 'b.ts', 'export const b = 1;\n', 'feat: b');
    await git(['push', 'origin', BRANCH_B], clone);

    await git(['checkout', 'main'], clone);

    const ticketA = await fileMergingTicket('task', null, { branch: BRANCH_A, prUrl: 'https://example.com/pr/201' });
    h.ctx.registries.forges.set('github', forgeFor(BRANCH_A));
    const nextA = await tickets.mergeDone(AGENT, ticketA, {});
    expect(nextA.status).toBe('done');

    // Ticket B's branch was cut from the same base, before A landed — merely stale, no conflict.
    const ticketB = await fileMergingTicket('task', null, { branch: BRANCH_B, prUrl: 'https://example.com/pr/202' });
    h.ctx.registries.forges.set('github', forgeFor(BRANCH_B));
    // A single mergeDone call succeeds directly: the daemon rebases the stale branch itself and
    // lands it, rather than rejecting so a worker has to re-sync and call mergeDone again.
    const nextB = await tickets.mergeDone(AGENT, ticketB, {});
    expect(nextB.status).toBe('done');

    const mainLog = await git(['log', '--oneline', 'main'], clone);
    expect(mainLog.stdout.trim().split('\n')).toHaveLength(3); // init + one squash commit per ticket
    expect((await git(['show', 'main:a.ts'], clone)).stdout).toMatch(/a = 1/);
    expect((await git(['show', 'main:b.ts'], clone)).stdout).toMatch(/b = 1/);
  });
});
