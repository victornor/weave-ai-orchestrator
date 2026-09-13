import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { OcError, type Project } from '@weave-ai/shared';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { git } from '../util/git.js';
import type { Actor, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const BRANCH = 'ac/tst-1-add-dark-mode';

describe('mergeDone forge-confirmed merge commit (VS-232)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let dir: string;
  let origin: string;
  let clone: string;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  beforeEach(async () => {
    h = makeHarness();
    const wake = fakeWake();
    const decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0), withdrawForTicket: vi.fn(() => 0) };
    const openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: '2026-09-04-tst-1-thing', skipped: null })),
    };
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.openspec = openspec as never;
    h.services.specs = fakeSpecs() as never;
    h.services.workers = {
      spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })),
      retireIfLanded: vi.fn(async () => ({ retired: true })),
    } as never;

    dir = mkdtempSync(join(tmpdir(), 'ac-merge-done-'));
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
        worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, knowledgeRepoEnabled: false, policies: { deliveryMode: 'pr' },
        status: 'ready', syncState: 'in_sync', lastFetchedAt: null, errorText: null,
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

  async function fileMergingTicket(): Promise<string> {
    const t = tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/42' });
    h.db.insert('worktrees', {
      id: newId(), projectId: h.projectId, ticketId: t.id, agentId: null, provider: 'git',
      path: clone, branch: BRANCH, status: 'active', createdAt: nowIso(),
    });
    h.db.update('tickets', t.id, { status: 'merging' });
    return t.id;
  }

  async function squashMergedTicket(): Promise<{ ticketId: string; squashSha: string }> {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await commit(clone, 'b.ts', 'export const b = 2;\n', 'feat: b');
    await git(['checkout', 'main'], clone);
    await git(['checkout', 'main'], origin);
    await git(['fetch', clone, `${BRANCH}:squash-src`], origin);
    await git(['merge', '--squash', 'squash-src'], origin);
    await git(['commit', '-m', 'feat: dark mode (#42)'], origin);
    const squashSha = await head(origin);
    return { ticketId: await fileMergingTicket(), squashSha };
  }

  /**
   * VS-227 topology plus an ancestor SHA that is on main but is not this PR's squash.
   * Content strategies cannot prove the land; merge-commit ancestry of `unrelatedAncestor` would
   * wrongly succeed if mergeDone forwarded a worker SHA the forge had not confirmed.
   */
  async function interveningSquashMergedTicket(): Promise<{ ticketId: string; squashSha: string; unrelatedAncestor: string }> {
    await commit(origin, 'shared.ts', 'alpha\n\nomega\n', 'shared');
    await git(['fetch', 'origin'], clone);
    await git(['merge', '--ff-only', 'origin/main'], clone);

    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'shared.ts', 'alpha-branch\n\nomega\n', 'feat: branch shared');
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['checkout', 'main'], clone);

    await commit(origin, 'shared.ts', 'alpha\n\nomega-other\n', 'chore: another PR');
    const unrelatedAncestor = await head(origin);
    await git(['fetch', clone, `${BRANCH}:squash-src`], origin);
    await git(['merge', '--squash', 'squash-src'], origin);
    await git(['commit', '-m', 'feat: dark mode (#42)'], origin);
    const squashSha = await head(origin);
    return { ticketId: await fileMergingTicket(), squashSha, unrelatedAncestor };
  }

  it('completes when the forge reports the squash commit as merged', async () => {
    const { ticketId, squashSha } = await squashMergedTicket();
    h.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'merged' as const, mergeCommit: squashSha }),
      mergePr: async () => ({}),
    });

    const next = await tickets.mergeDone(AGENT, ticketId, { mergeCommit: squashSha, method: 'squash' });
    expect(next.status).toBe('done');
    expect(next.delivery).toMatchObject({ merged: true, mergeCommit: squashSha });
  });

  it('refuses a worker SHA that is not the forge merge commit', async () => {
    const { ticketId, squashSha } = await squashMergedTicket();
    h.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'merged' as const, mergeCommit: squashSha }),
      mergePr: async () => ({}),
    });

    await expect(tickets.mergeDone(AGENT, ticketId, { mergeCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', method: 'squash' }))
      .rejects.toMatchObject({
        code: 'merge_unverified',
        details: expect.objectContaining({
          reported: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          forge: squashSha,
          prUrl: 'https://example.com/pr/42',
        }),
      });
    expect(tickets.get(ticketId).status).toBe('merging');
  });

  it('still lands a last-to-land squash when the forge is unreachable, without the worker SHA', async () => {
    const { ticketId } = await squashMergedTicket();
    h.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => { throw new Error('forge down'); },
      mergePr: async () => ({}),
    });

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
  });

  it('uses the forge SHA when the worker omits mergeCommit, including an intervening squash', async () => {
    const { ticketId, squashSha } = await interveningSquashMergedTicket();
    h.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'merged' as const, mergeCommit: squashSha }),
      mergePr: async () => ({}),
    });

    const next = await tickets.mergeDone(AGENT, ticketId, {});
    expect(next.status).toBe('done');
    expect(next.delivery).toMatchObject({ merged: true, mergeCommit: squashSha });
  });

  it('does not treat a worker-named ancestor of main as proof when the forge is unreachable', async () => {
    const { ticketId, unrelatedAncestor } = await interveningSquashMergedTicket();
    h.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => { throw new Error('forge down'); },
      mergePr: async () => ({}),
    });

    await expect(tickets.mergeDone(AGENT, ticketId, { mergeCommit: unrelatedAncestor, method: 'squash' }))
      .rejects.toMatchObject({ code: 'merge_unverified' });
    expect(tickets.get(ticketId).status).toBe('merging');
  });

  it('preserves a blocked archive\'s code and fix guidance instead of flattening it to internal (VS-298)', async () => {
    const { ticketId, squashSha } = await squashMergedTicket();
    h.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'merged' as const, mergeCommit: squashSha }),
      mergePr: async () => ({}),
    });
    const fix = "'runtime-credentials/serialized-refresh' declares retire_capabilities, but the spec holds content the merge cannot safely account for and deleting the file would take with it. Move it into `## Purpose` or a canonical requirement, or delete the spec by hand.";
    (h.services.openspec as unknown as { archiveAfterMerge: ReturnType<typeof vi.fn> }).archiveAfterMerge =
      vi.fn(async () => { throw new OcError('openspec_archive_blocked', `openspec archive tst-1-thing blocked: Rebuilt spec for 'runtime-credentials/serialized-refresh' failed validation. No files were changed. ${fix}`, { openspecCode: 'archive_spec_validation_failed', fix }); });

    await expect(tickets.mergeDone(AGENT, ticketId, { mergeCommit: squashSha, method: 'squash' }))
      .rejects.toMatchObject({ code: 'openspec_archive_blocked', details: expect.objectContaining({ openspecCode: 'archive_spec_validation_failed', fix, ticketId }) });

    const t = tickets.get(ticketId);
    expect(t.status).toBe('merging');
    expect(t.unblock?.action).toContain(fix);
    const comments = tickets.comments(ticketId);
    expect(comments.some((c) => c.body.includes(fix))).toBe(true);
  });
});
