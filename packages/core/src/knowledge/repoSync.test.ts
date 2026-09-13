import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from './service.js';
import { git } from '../util/git.js';
import { changedKnowledgePaths, reconcileProjectKnowledgeFromRepo } from './repoSync.js';
import type { Actor, KnowledgeService } from '../api.js';

describe('changedKnowledgePaths (VS-358)', () => {
  let dir: string;
  const commit = async (repo: string, msg: string): Promise<string> => {
    await git(['add', '-A'], repo);
    await git(['commit', '-m', msg], repo);
    return (await git(['rev-parse', 'HEAD'], repo)).stdout.trim();
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-changed-paths-'));
    await git(['init', '-b', 'main'], dir);
    await git(['config', 'user.email', 't@e.com'], dir);
    await git(['config', 'user.name', 'T'], dir);
    writeFileSync(join(dir, 'README.md'), '# api\n');
    await commit(dir, 'init');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ignores a commit that never touched .weave/knowledge/', async () => {
    const sha1 = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
    writeFileSync(join(dir, 'README.md'), '# api v2\n');
    const sha2 = await commit(dir, 'unrelated');
    expect(await changedKnowledgePaths(dir, sha1, sha2)).toEqual([]);
  });

  it('reports an added hub file and a modification', async () => {
    const sha1 = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
    mkdirSync(join(dir, '.weave', 'knowledge', 'docs'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'knowledge', 'PROJECT.md'), '# API\n');
    const sha2 = await commit(dir, 'add hub');
    writeFileSync(join(dir, '.weave', 'knowledge', 'PROJECT.md'), '# API\n\n## Learnings\n- one\n');
    writeFileSync(join(dir, '.weave', 'knowledge', 'docs', 'run-engine.md'), '# Run engine\n');
    const sha3 = await commit(dir, 'modify hub, add doc');

    expect(await changedKnowledgePaths(dir, sha1, sha2)).toEqual([{ path: 'PROJECT.md', status: 'added' }]);
    const secondDiff = await changedKnowledgePaths(dir, sha2, sha3);
    expect(secondDiff).toContainEqual({ path: 'PROJECT.md', status: 'modified' });
    expect(secondDiff).toContainEqual({ path: 'docs/run-engine.md', status: 'added' });
  });

  it('reports a deleted document', async () => {
    mkdirSync(join(dir, '.weave', 'knowledge', 'docs'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'knowledge', 'docs', 'run-engine.md'), '# Run engine\n');
    const sha1 = await commit(dir, 'add doc');
    rmSync(join(dir, '.weave', 'knowledge', 'docs', 'run-engine.md'));
    const sha2 = await commit(dir, 'delete doc');
    expect(await changedKnowledgePaths(dir, sha1, sha2)).toEqual([{ path: 'docs/run-engine.md', status: 'deleted' }]);
  });
});

describe('reconcileProjectKnowledgeFromRepo (VS-358)', () => {
  let h: TestHarness;
  let knowledge: KnowledgeService;
  let clonePath: string;
  let ticketNumber = 0;

  const commit = async (msg: string): Promise<string> => {
    await git(['add', '-A'], clonePath);
    await git(['commit', '-m', msg], clonePath);
    return (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
  };
  const writeHub = (body: string): void => writeFileSync(join(clonePath, '.weave', 'knowledge', 'PROJECT.md'), body);
  const writeDoc = (name: string, body: string): void => {
    mkdirSync(join(clonePath, '.weave', 'knowledge', 'docs'), { recursive: true });
    writeFileSync(join(clonePath, '.weave', 'knowledge', 'docs', name), body);
  };

  /** A real ticket row, so `knowledge_revisions.ticket_id` can distinguish "the landing ticket's own edit" from a concurrent one. */
  function makeTicket(): string {
    const id = newId();
    const ts = nowIso();
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId: h.projectId, number: ++ticketNumber, identifier: `TST-${ticketNumber}`,
      kind: 'task', title: `Ticket ${ticketNumber}`, description: '', status: 'todo', priority: 'medium',
      createdByKind: 'human', createdAt: ts, updatedAt: ts,
    });
    return id;
  }
  /** An actor whose run is bound to `ticketId`, so `write()`'s provenance lookup attributes the revision to it. */
  function actorFor(ticketId: string): Actor {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, ticketId, runtimeId: 'claude',
      status: 'running', turnEpoch: 0, cwd: h.root, createdAt: nowIso(),
    });
    return { kind: 'agent', id: h.conductorId, runId };
  }

  beforeEach(async () => {
    h = makeHarness();
    // Placeholder actors here have no backing `runs` row, so `write()`'s provenance lookup always
    // resolves no ticket. This file's `project()` helper reads the row directly from `h.ctx.db` for
    // `reconcileProjectKnowledgeFromRepo` itself; this fake only short-circuits the unrelated
    // out-of-ticket pull-request path (VS-358) that `note`/`putDoc` would otherwise also attempt.
    h.services.projects = { get: () => ({ knowledgeRepoEnabled: false }) } as never;
    knowledge = createKnowledgeService(h.ctx, h.deps);
    h.services.knowledge = knowledge;
    clonePath = h.ctx.paths.projects + '/api';
    mkdirSync(join(clonePath, '.weave', 'knowledge'), { recursive: true });
    await git(['init', '-b', 'main'], clonePath);
    await git(['config', 'user.email', 't@e.com'], clonePath);
    await git(['config', 'user.name', 'T'], clonePath);
    writeFileSync(join(clonePath, 'README.md'), '# api\n');
    await commit('init');
    h.db.update('projects', h.projectId, { clonePath, knowledgeRepoEnabled: 1 });
  });
  afterEach(() => h.cleanup());

  function project() {
    return h.ctx.db.get<{ id: string; slug: string; clonePath: string }>('SELECT id, slug, clone_path AS clonePath FROM projects WHERE id = ?', [h.projectId])! as never;
  }

  it('is a no-op when the landing touched no knowledge path', async () => {
    const before = knowledge.get('project', h.projectId).revision;
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeFileSync(join(clonePath, 'README.md'), '# api v2\n');
    const afterSha = await commit('unrelated change');
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, null);
    expect(knowledge.get('project', h.projectId).revision).toBe(before);
  });

  it('merges a changed hub file into the workspace copy', async () => {
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeHub('# API\n\n## Landmines\n- 2026-01-01 · landed via a resolved conflict\n');
    const afterSha = await commit('update hub');
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, null);
    expect(knowledge.get('project', h.projectId).body).toContain('landed via a resolved conflict');
  });

  it('adds a new document that landed, with no landing ticket recorded', async () => {
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeDoc('run-engine.md', '# Run engine\n\nOne turn end to end.\n');
    const afterSha = await commit('add doc');
    // A brand-new document (no workspace row yet) has nothing to clobber, so this applies even with
    // no landing ticket to compare against — e.g. a resolved conflict or a hand-edited file.
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, null);
    expect(knowledge.getDoc('project', 'run-engine', h.projectId).body).toBe('# Run engine\n\nOne turn end to end.\n');
    const revs = h.db.all<{ reason: string }>(
      `SELECT r.reason FROM knowledge_revisions r JOIN knowledge_files f ON f.id = r.file_id WHERE f.path = ? ORDER BY r.revision DESC LIMIT 1`,
      ['projects/api/docs/run-engine.md'],
    );
    expect(revs[0]!.reason).toBe('merge-sync');
  });

  it("removes a document the landing ticket's own revision deleted", async () => {
    const ticketA = makeTicket();
    const actorA = actorFor(ticketA);
    writeDoc('run-engine.md', '# Run engine\n\nOne turn end to end.\n');
    const beforeSha = await commit('add doc');
    knowledge.putDoc(actorA, 'project', 'run-engine', '# Run engine\n\nOne turn end to end.\n', h.projectId);
    rmSync(join(clonePath, '.weave', 'knowledge', 'docs', 'run-engine.md'));
    const afterSha = await commit('ticket A deletes its own doc');
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, ticketA);
    expect(() => knowledge.getDoc('project', 'run-engine', h.projectId)).toThrow(/does not exist/);
  });

  it('does not delete a document a different (or no) ticket has since rewritten', async () => {
    const ticketA = makeTicket();
    const actorA = actorFor(ticketA);
    writeDoc('run-engine.md', '# Run engine\n\nOriginal.\n');
    const beforeSha = await commit('add doc');
    knowledge.putDoc(actorA, 'project', 'run-engine', '# Run engine\n\nOriginal.\n', h.projectId);
    rmSync(join(clonePath, '.weave', 'knowledge', 'docs', 'run-engine.md'));
    const afterSha = await commit('ticket A deletes its own doc');
    // A concurrent, newer workspace write from a different actor — this ticket's landing must not delete it.
    knowledge.putDoc({ kind: 'human', id: 'victor' }, 'project', 'run-engine', '# Run engine\n\nConcurrent rewrite.\n', h.projectId);
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, ticketA);
    expect(knowledge.getDoc('project', 'run-engine', h.projectId).body).toContain('Concurrent rewrite.');
  });

  it("does not apply a landed document when the landing ticket has no revision of it (changed by hand in git)", async () => {
    const ticketA = makeTicket();
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeDoc('run-engine.md', '# Run engine\n\nHand-edited, never through a tool call.\n');
    const afterSha = await commit('hand-edit the doc directly in git');
    // The workspace already has some content for this path (e.g. from an earlier, unrelated write) — the
    // landing ticket cannot prove it is not clobbering something concurrent, so it is left alone.
    knowledge.putDoc({ kind: 'human', id: 'victor' }, 'project', 'run-engine', '# Run engine\n\nWorkspace content.\n', h.projectId);
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, ticketA);
    expect(knowledge.getDoc('project', 'run-engine', h.projectId).body).toContain('Workspace content.');
  });

  it("plan review round 2: does not overwrite a document a concurrent, newer workspace write produced, even though the landing ticket wrote it too", async () => {
    const ticketA = makeTicket();
    const actorA = actorFor(ticketA);
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    // Ticket A's own landed version — this is what actually reaches the repo.
    knowledge.putDoc(actorA, 'project', 'run-engine', '# Run engine\n\nTicket A landed version.\n', h.projectId);
    writeDoc('run-engine.md', '# Run engine\n\nTicket A landed version.\n');
    const afterSha = await commit('ticket A lands its doc');
    // Before reconciliation runs, a different, newer workspace write supersedes it — a squash-merge
    // landing has one commit whose author date is the merge time, so a commit-date comparison could
    // never tell this apart from "landed after"; the revision counter can.
    knowledge.putDoc({ kind: 'human', id: 'victor' }, 'project', 'run-engine', '# Run engine\n\nNewer concurrent version.\n', h.projectId);
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, ticketA);
    expect(knowledge.getDoc('project', 'run-engine', h.projectId).body).toContain('Newer concurrent version.');
  });

  it('scenario: an unmerged ticket note survives an unrelated landing for the same project', async () => {
    // Ticket A's live note, never landed.
    knowledge.note({ kind: 'human', id: 'victor' }, 'project', 'Landmines', 'Ticket A: still unmerged.', h.projectId);
    const before = knowledge.get('project', h.projectId).body;
    expect(before).toContain('Ticket A: still unmerged.');

    // Ticket B lands, unrelated to the hub.
    const ticketB = makeTicket();
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeFileSync(join(clonePath, 'README.md'), '# api v2\n');
    const afterSha = await commit('unrelated ticket B change');
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, ticketB);

    expect(knowledge.get('project', h.projectId).body).toContain('Ticket A: still unmerged.');
  });

  it('search finds content that only entered the workspace copy through reconciliation', async () => {
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeHub('# API\n\n## Landmines\n- 2026-01-01 · gizmoflange never resets between requests\n');
    const afterSha = await commit('hub content from a resolved conflict');
    await reconcileProjectKnowledgeFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha, null);
    const hits = knowledge.search('gizmoflange', h.projectId);
    expect(hits.some((hit) => hit.ref === 'projects/api/PROJECT.md')).toBe(true);
  });
});
