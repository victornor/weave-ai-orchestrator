/**
 * VS-358: when `write()` fires (or does not fire) the out-of-ticket knowledge pull request, driven
 * through `note()`/`putDoc()` against a real git clone standing in for the project's primary clone.
 * `repoDelivery.test.ts` covers `requestKnowledgeRepoPr`'s own git mechanics; this covers the trigger.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from './service.js';
import { git } from '../util/git.js';
import type { Actor, KnowledgeService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
/** Real git subprocesses run inside the fired-and-forgotten pull-request path; poll instead of a fixed sleep. */
async function untilCalled(fn: ReturnType<typeof vi.fn>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (fn.mock.calls.length === 0 && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 20));
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

describe('the out-of-ticket knowledge pull request trigger (VS-358)', () => {
  let h: TestHarness;
  let knowledge: KnowledgeService;
  let createPullRequest: ReturnType<typeof vi.fn>;
  let origin: string;

  beforeEach(async () => {
    h = makeHarness();
    // A real clone standing in for the project's primary clone, so requestKnowledgeRepoPr's git
    // plumbing has somewhere real to push to.
    origin = join(h.root, 'origin');
    await git(['init', '-b', 'main', origin], h.root);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    writeFileSync(join(origin, 'README.md'), '# api\n');
    await git(['add', '.'], origin);
    await git(['commit', '-m', 'init'], origin);
    const clonePath = h.ctx.paths.projects + '/api';
    mkdirSync(clonePath, { recursive: true });
    await git(['clone', origin, clonePath], h.root);
    await git(['config', 'user.email', 'test@example.com'], clonePath);
    await git(['config', 'user.name', 'Test'], clonePath);
    h.db.update('projects', h.projectId, { clonePath });

    createPullRequest = vi.fn(async (_cwd: string, opts: { branch: string; base: string }) => ({ url: 'https://example.com/pr/1', number: 1 }));
    const forge: ForgeAdapter = {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' }), mergePr: async () => ({}),
      createPullRequest, pullRequestForBranch: async () => null,
    };
    h.ctx.registries.forges.set('github', forge);

    h.services.wake = { enqueue: vi.fn(() => ({ id: 'w1' })) } as never;
    h.services.workers = { spawnCurator: vi.fn(), conductor: vi.fn(() => ({ id: h.conductorId })) } as never;
    knowledge = createKnowledgeService(h.ctx, h.deps);
    h.services.knowledge = knowledge;
    h.services.projects = { get: (id: string) => h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE workspace_id = ? AND (id = ? OR slug = ?)', [h.workspaceId, id, id]) as never, fetch: async () => ({ head: 'x', fastForwarded: false }) } as never;
  });
  afterEach(() => h.cleanup());

  function actorFor(ticketId: string | null): Actor {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, ticketId, runtimeId: 'claude',
      status: 'running', turnEpoch: 0, cwd: h.root, createdAt: nowIso(),
    });
    return { kind: 'agent', id: h.conductorId, runId };
  }

  it('fires for a weaver-shaped out-of-ticket write to an opted-in project', async () => {
    h.db.run('UPDATE projects SET knowledge_repo_enabled = 1 WHERE id = ?', [h.projectId]);
    knowledge.note(actorFor(null), 'project', 'Landmines', 'The retry loop never backs off.', h.projectId);
    await untilCalled(createPullRequest);
    expect(createPullRequest).toHaveBeenCalledTimes(1);
    expect(createPullRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ branch: 'ac/knowledge-api' }));
  });

  it("plan review round 2: the weaver's out-of-ticket PR branch never carries a different ticket's unmerged note on the same hub", async () => {
    h.db.run('UPDATE projects SET knowledge_repo_enabled = 1 WHERE id = ?', [h.projectId]);
    const ts = nowIso();
    const ticketId = newId();
    h.db.insert('tickets', { id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task', title: 'x', status: 'todo', priority: 'medium', createdByKind: 'human', createdAt: ts, updatedAt: ts });

    // Ticket A's worker notes the hub and does not land.
    knowledge.note(actorFor(ticketId), 'project', 'Landmines', "Ticket A's unmerged note.", h.projectId);
    // The weaver notes the same hub out of ticket — the workspace body now carries both entries.
    knowledge.note(actorFor(null), 'project', 'Landmines', "The weaver's own note.", h.projectId);
    expect(knowledge.get('project', h.projectId).body).toContain("Ticket A's unmerged note.");

    await untilCalled(createPullRequest);
    const branchContent = (await git(['show', 'refs/heads/ac/knowledge-api:.weave/knowledge/PROJECT.md'], origin)).stdout;
    expect(branchContent).toContain("The weaver's own note.");
    expect(branchContent).not.toContain("Ticket A's unmerged note.");
  });

  it('does not fire for a ticket-scoped write, even to an opted-in project', async () => {
    h.db.run('UPDATE projects SET knowledge_repo_enabled = 1 WHERE id = ?', [h.projectId]);
    const ts = nowIso();
    const ticketId = newId();
    h.db.insert('tickets', { id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task', title: 'x', status: 'todo', priority: 'medium', createdByKind: 'human', createdAt: ts, updatedAt: ts });
    knowledge.note(actorFor(ticketId), 'project', 'Landmines', 'A ticket-scoped note.', h.projectId);
    await tick();
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it('does not fire for an out-of-ticket write to an opted-out project', async () => {
    knowledge.note(actorFor(null), 'project', 'Landmines', 'Not opted in, no PR.', h.projectId);
    await tick();
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("does not fire for a human's direct edit route when the project is opted out", async () => {
    knowledge.putDoc(HUMAN, 'project', 'run-engine', '# Run engine\n\nOne turn end to end.\n', h.projectId);
    await tick();
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it('the workspace write returns synchronously, before the pull request settles', async () => {
    h.db.run('UPDATE projects SET knowledge_repo_enabled = 1 WHERE id = ?', [h.projectId]);
    // The forge call is deliberately slow; note() must still return, and the workspace copy must
    // already reflect the write, before it resolves.
    createPullRequest.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 200)); return { url: 'https://example.com/pr/1', number: 1 }; });
    const result = knowledge.note(actorFor(null), 'project', 'Landmines', 'Written before the PR settles.', h.projectId);
    expect(result.revision).toBeGreaterThan(0);
    expect(knowledge.get('project', h.projectId).body).toContain('Written before the PR settles.');
    expect(createPullRequest).not.toHaveBeenCalled(); // not even started synchronously
    await tick();
  });
});
