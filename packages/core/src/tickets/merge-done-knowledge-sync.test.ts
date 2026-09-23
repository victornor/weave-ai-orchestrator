/**
 * VS-358: mergeDone reconciles the workspace's knowledge copy from what an opted-in project's
 * landing actually changed under `.weave/knowledge/`. The git/merge mechanics themselves are already
 * covered by `merge-done.test.ts`; this covers the sync-on-merge wiring and its two central races.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import type { Project } from '@weave-ai/shared';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createKnowledgeService } from '../knowledge/service.js';
import { git } from '../util/git.js';
import type { Actor, KnowledgeService, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };

describe('mergeDone syncs knowledge for an opted-in project (VS-358)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let knowledge: KnowledgeService;
  let dir: string;
  let origin: string;
  let clone: string;
  let knowledgeRepoEnabled: boolean;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  beforeEach(async () => {
    h = makeHarness();
    knowledgeRepoEnabled = true;
    const wake = fakeWake();
    h.services.wake = wake as never;
    h.services.decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0), withdrawForTicket: vi.fn(() => 0) } as never;
    h.services.openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: 'ticket has no openspec change' })),
    } as never;
    h.services.specs = fakeSpecs() as never;
    h.services.workers = {
      spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })),
      retireIfLanded: vi.fn(async () => ({ retired: true })),
    } as never;

    dir = mkdtempSync(join(tmpdir(), 'ac-merge-knowledge-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');
    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    await commit(origin, 'README.md', '# api\n', 'init');
    mkdirSync(join(origin, '.weave', 'knowledge'), { recursive: true });
    await commit(origin, '.weave/knowledge/PROJECT.md', '# API\n\n## Landmines\n- 2026-01-01 · original\n', 'seed knowledge');
    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);

    knowledge = createKnowledgeService(h.ctx, h.deps);
    h.services.knowledge = knowledge;
    // Seed the workspace copy to match the repo's current state, as it would be after an earlier sync.
    knowledge.replace({ kind: 'system', id: null }, 'project', '# API\n\n## Landmines\n- 2026-01-01 · original\n', 'merge-sync', h.projectId);

    h.services.projects = {
      get: () => ({
        id: h.projectId, workspaceId: h.workspaceId, slug: 'api', name: 'API', gitUrl: 'git@example.com:acme/api.git',
        defaultBranch: 'main', landingBranch: null, clonePath: clone, maxWorkers: 4, setupCommand: null,
        worktreeProvider: 'git', openspecEnabled: false, openspecVersion: null, knowledgeRepoEnabled, knowledgeSwitch: null, policies: { deliveryMode: 'pr' },
        status: 'ready', syncState: 'in_sync', primaryCloneSyncedHead: null, lastFetchedAt: null, errorText: null,
      } satisfies Project),
    } as never;

    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  afterEach(async () => { await tickets.stop(); h.cleanup(); rmSync(dir, { recursive: true, force: true }); });

  async function landTicketChangingHub(branch: string, entry: string): Promise<string> {
    await git(['checkout', '-b', branch], clone);
    const body = `# API\n\n## Landmines\n- 2026-01-01 · original\n- ${entry}\n`;
    await commit(clone, '.weave/knowledge/PROJECT.md', body, `feat: note ${entry}`);
    await git(['checkout', 'main'], clone);
    await git(['checkout', 'main'], origin);
    await git(['fetch', clone, `${branch}:squash-src`], origin);
    await git(['merge', '--squash', 'squash-src'], origin);
    await git(['commit', '-m', `feat: ${entry} (#1)`], origin);
    const squashSha = await head(origin);

    const t = tickets.create(HUMAN, { kind: 'task', title: `Note ${entry}`, projectId: h.projectId, assigneeRoleId: h.roleId });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.insert('worktrees', { id: newId(), projectId: h.projectId, ticketId: t.id, agentId: null, provider: 'git', path: clone, branch, status: 'active', createdAt: nowIso() });
    h.db.update('tickets', t.id, { status: 'merging' });
    h.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'merged' as const, mergeCommit: squashSha }), mergePr: async () => ({}),
    });
    const next = await tickets.mergeDone(AGENT, t.id, { mergeCommit: squashSha, method: 'squash' });
    expect(next.status).toBe('done');
    return t.id;
  }

  it('leaves the workspace copy matching the landed content by the time mergeDone returns', async () => {
    await landTicketChangingHub('ac/tst-1-note-a', '2026-01-02 · landed via ticket A');
    expect(knowledge.get('project', h.projectId).body).toContain('landed via ticket A');
  });

  it('runs no reconciliation for an opted-out project', async () => {
    knowledgeRepoEnabled = false;
    const before = knowledge.get('project', h.projectId).revision;
    await landTicketChangingHub('ac/tst-1-note-b', '2026-01-02 · never synced');
    expect(knowledge.get('project', h.projectId).revision).toBe(before);
    expect(knowledge.get('project', h.projectId).body).not.toContain('never synced');
  });

  it('preserves an unmerged ticket note when a different ticket for the same project lands', async () => {
    knowledge.note({ kind: 'human', id: 'victor' }, 'project', 'Landmines', 'Ticket A: still unmerged.', h.projectId);
    expect(knowledge.get('project', h.projectId).body).toContain('Ticket A: still unmerged.');

    await landTicketChangingHub('ac/tst-1-note-c', '2026-01-02 · ticket B landed');

    const body = knowledge.get('project', h.projectId).body;
    expect(body).toContain('ticket B landed');
    expect(body).toContain('Ticket A: still unmerged.');
  });
});
