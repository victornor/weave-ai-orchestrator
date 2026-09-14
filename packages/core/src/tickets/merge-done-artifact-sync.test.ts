/**
 * VS-360: proves `mergeDone` actually calls `reconcileProjectArtifactsFromRepo` (its own logic is
 * covered directly, and more thoroughly, by `artifactRepoSync.test.ts`) — the wiring, and that an
 * opted-out project runs none of it, exactly mirroring `merge-done-knowledge-sync.test.ts`'s shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import type { Project } from '@weave-ai/shared';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { git } from '../util/git.js';
import type { Actor, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };

describe('mergeDone syncs ticket artifacts for an opted-in project (VS-360)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
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

    dir = mkdtempSync(join(tmpdir(), 'ac-merge-artifact-'));
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
        worktreeProvider: 'git', openspecEnabled: false, openspecVersion: null, knowledgeRepoEnabled, knowledgeSwitch: null, policies: { deliveryMode: 'pr' },
        status: 'ready', syncState: 'in_sync', lastFetchedAt: null, errorText: null,
      } satisfies Project),
    } as never;

    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  afterEach(async () => { await tickets.stop(); h.cleanup(); rmSync(dir, { recursive: true, force: true }); });

  /** Lands a ticket whose branch commits an artifact file directly (as a "human" would, not through the tool). */
  async function landTicketWithArtifact(branch: string, html: string): Promise<{ id: string; identifier: string }> {
    const t = tickets.create(HUMAN, { kind: 'task', title: `Artifact via ${branch}`, projectId: h.projectId, assigneeRoleId: h.roleId });
    await git(['checkout', 'main'], clone);
    await git(['checkout', '-b', branch], clone);
    mkdirSync(join(clone, '.weave', 'artifacts', t.identifier), { recursive: true });
    writeFileSync(join(clone, '.weave', 'artifacts', t.identifier, 'overview.html'), html);
    await git(['add', '.'], clone);
    await git(['commit', '-m', `feat: artifact for ${t.identifier}`], clone);
    await git(['checkout', 'main'], clone);
    await git(['checkout', 'main'], origin);
    await git(['fetch', clone, `${branch}:squash-src`], origin);
    await git(['merge', '--squash', 'squash-src'], origin);
    await git(['commit', '-m', `feat: artifact for ${t.identifier} (#1)`], origin);
    const squashSha = await head(origin);

    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.insert('worktrees', { id: newId(), projectId: h.projectId, ticketId: t.id, agentId: null, provider: 'git', path: clone, branch, status: 'active', createdAt: nowIso() });
    h.db.update('tickets', t.id, { status: 'merging' });
    h.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'merged' as const, mergeCommit: squashSha }), mergePr: async () => ({}),
    });
    const next = await tickets.mergeDone(AGENT, t.id, { mergeCommit: squashSha, method: 'squash' });
    expect(next.status).toBe('done');
    return t;
  }

  it('leaves the stored artifact matching the landed content by the time mergeDone returns', async () => {
    const html = '<!doctype html><html><body><h1>from the repo</h1></body></html>';
    const t = await landTicketWithArtifact('ac/tst-artifact-a', html);
    const doc = tickets.getDocument(t.id, 'artifact:overview');
    expect(doc?.body).toBe(html);
    expect(doc?.revision).toBe(1);
  });

  it('runs no artifact reconciliation for an opted-out project', async () => {
    knowledgeRepoEnabled = false;
    const html = '<!doctype html><html><body><h1>should not sync</h1></body></html>';
    const t = await landTicketWithArtifact('ac/tst-artifact-b', html);
    expect(tickets.getDocument(t.id, 'artifact:overview')).toBeNull();
  });
});
