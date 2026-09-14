import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { git } from '../util/git.js';
import { changedArtifactPaths, reconcileProjectArtifactsFromRepo } from './artifactRepoSync.js';
import type { Actor, TicketsService } from '../api.js';

const SAMPLE_HTML = '<!doctype html><html><body><h1>v1</h1></body></html>';
const SAMPLE_HTML_V2 = '<!doctype html><html><body><h1>v2</h1></body></html>';

describe('changedArtifactPaths (VS-360)', () => {
  let dir: string;
  const commit = async (repo: string, msg: string): Promise<string> => {
    await git(['add', '-A'], repo);
    await git(['commit', '-m', msg], repo);
    return (await git(['rev-parse', 'HEAD'], repo)).stdout.trim();
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-changed-artifact-paths-'));
    await git(['init', '-b', 'main'], dir);
    await git(['config', 'user.email', 't@e.com'], dir);
    await git(['config', 'user.name', 'T'], dir);
    writeFileSync(join(dir, 'README.md'), '# api\n');
    await commit(dir, 'init');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ignores a commit that never touched .weave/artifacts/', async () => {
    const sha1 = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
    writeFileSync(join(dir, 'README.md'), '# api v2\n');
    const sha2 = await commit(dir, 'unrelated');
    expect(await changedArtifactPaths(dir, sha1, sha2)).toEqual([]);
  });

  it('reports an added artifact and a later modification', async () => {
    const sha1 = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
    mkdirSync(join(dir, '.weave', 'artifacts', 'TST-1'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.html'), SAMPLE_HTML);
    const sha2 = await commit(dir, 'add artifact');
    writeFileSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.html'), SAMPLE_HTML_V2);
    const sha3 = await commit(dir, 'modify artifact');

    expect(await changedArtifactPaths(dir, sha1, sha2)).toEqual([{ ticketIdentifier: 'TST-1', key: 'overview', status: 'added' }]);
    expect(await changedArtifactPaths(dir, sha2, sha3)).toEqual([{ ticketIdentifier: 'TST-1', key: 'overview', status: 'modified' }]);
  });

  it('folds a .meta.json-only change into the same entry, as modified', async () => {
    mkdirSync(join(dir, '.weave', 'artifacts', 'TST-1'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.html'), SAMPLE_HTML);
    writeFileSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.meta.json'), '{"title":null,"kind":null}\n');
    const sha1 = await commit(dir, 'add artifact + meta');
    writeFileSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.meta.json'), '{"title":"Overview","kind":"diagram"}\n');
    const sha2 = await commit(dir, 'meta only change');
    expect(await changedArtifactPaths(dir, sha1, sha2)).toEqual([{ ticketIdentifier: 'TST-1', key: 'overview', status: 'modified' }]);
  });

  it('reports a deleted artifact', async () => {
    mkdirSync(join(dir, '.weave', 'artifacts', 'TST-1'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.html'), SAMPLE_HTML);
    const sha1 = await commit(dir, 'add artifact');
    rmSync(join(dir, '.weave', 'artifacts', 'TST-1', 'overview.html'));
    const sha2 = await commit(dir, 'delete artifact');
    expect(await changedArtifactPaths(dir, sha1, sha2)).toEqual([{ ticketIdentifier: 'TST-1', key: 'overview', status: 'deleted' }]);
  });

  it('ignores a path that is not the <identifier>/<key> shape', async () => {
    const sha1 = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
    mkdirSync(join(dir, '.weave', 'artifacts'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'artifacts', 'stray.txt'), 'not an artifact');
    const sha2 = await commit(dir, 'stray file');
    expect(await changedArtifactPaths(dir, sha1, sha2)).toEqual([]);
  });
});

describe('reconcileProjectArtifactsFromRepo (VS-360)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let clonePath: string;
  let ticketNumber = 0;

  const commit = async (msg: string): Promise<string> => {
    await git(['add', '-A'], clonePath);
    await git(['commit', '-m', msg], clonePath);
    return (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
  };
  const writeArtifact = (identifier: string, key: string, html: string): void => {
    mkdirSync(join(clonePath, '.weave', 'artifacts', identifier), { recursive: true });
    writeFileSync(join(clonePath, '.weave', 'artifacts', identifier, `${key}.html`), html);
  };
  const writeMeta = (identifier: string, key: string, meta: { title?: string | null; kind?: string | null }): void => {
    mkdirSync(join(clonePath, '.weave', 'artifacts', identifier), { recursive: true });
    writeFileSync(join(clonePath, '.weave', 'artifacts', identifier, `${key}.meta.json`), JSON.stringify(meta));
  };
  const removeArtifact = (identifier: string, key: string): void => rmSync(join(clonePath, '.weave', 'artifacts', identifier, `${key}.html`));

  /** A real ticket row, bypassing `tickets.create()` entirely (as `repoSync.test.ts` does for knowledge). */
  function makeTicket(projectId = h.projectId): { id: string; identifier: string } {
    const id = newId();
    const ts = nowIso();
    const identifier = `TST-${++ticketNumber}`;
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId, number: ticketNumber, identifier,
      kind: 'task', title: `Ticket ${ticketNumber}`, description: '', status: 'todo', priority: 'medium',
      createdByKind: 'human', createdAt: ts, updatedAt: ts,
    });
    return { id, identifier };
  }

  const SYSTEM_ACTOR: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };

  beforeEach(async () => {
    h = makeHarness();
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    clonePath = h.ctx.paths.projects + '/api';
    mkdirSync(join(clonePath, '.weave', 'artifacts'), { recursive: true });
    await git(['init', '-b', 'main'], clonePath);
    await git(['config', 'user.email', 't@e.com'], clonePath);
    await git(['config', 'user.name', 'T'], clonePath);
    writeFileSync(join(clonePath, 'README.md'), '# api\n');
    await commit('init');
    h.db.update('projects', h.projectId, { clonePath, knowledgeRepoEnabled: 1 });
  });
  afterEach(async () => { await tickets.stop(); h.cleanup(); });

  function project() {
    return h.ctx.db.get<{ id: string; slug: string; clonePath: string }>('SELECT id, slug, clone_path AS clonePath FROM projects WHERE id = ?', [h.projectId])! as never;
  }

  it('is a no-op when the landing touched no artifact path', async () => {
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeFileSync(join(clonePath, 'README.md'), '# api v2\n');
    const afterSha = await commit('unrelated change');
    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);
    // No crash and, more concretely, no work products materialize from a no-op run.
    expect(h.db.all('SELECT * FROM ticket_work_products')).toHaveLength(0);
  });

  it('records a new revision for an artifact with no prior stored revision (a hand-edited file)', async () => {
    const t = makeTicket();
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeArtifact(t.identifier, 'overview', SAMPLE_HTML);
    writeMeta(t.identifier, 'overview', { title: 'Overview', kind: 'diagram' });
    const afterSha = await commit('human adds an artifact directly');
    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);

    const doc = tickets.getDocument(t.id, 'artifact:overview');
    expect(doc?.body).toBe(SAMPLE_HTML);
    expect(doc?.revision).toBe(1);
    const products = tickets.workProducts(t.id);
    expect(products).toMatchObject([{ type: 'artifact', externalId: 'overview', title: 'Overview' }]);
  });

  it('is a no-op when the landed body matches the current stored revision (the worker\'s own ordinary publish)', async () => {
    const t = makeTicket();
    tickets.putDocument(SYSTEM_ACTOR, t.id, 'artifact:overview', SAMPLE_HTML, { system: true });
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeArtifact(t.identifier, 'overview', SAMPLE_HTML);
    const afterSha = await commit('worker commits its own already-stored publish');
    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);
    expect(tickets.getDocument(t.id, 'artifact:overview')?.revision).toBe(1);
  });

  it('skips a stale landing that matches an older, non-current revision rather than reverting to it', async () => {
    const t = makeTicket();
    // Revision 1 (v1) recorded in the DB — nothing committed to the branch yet.
    tickets.putDocument(SYSTEM_ACTOR, t.id, 'artifact:overview', SAMPLE_HTML, { system: true });
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    // Revision 2 (v2) recorded in the DB — now the current one — but the commit that actually lands
    // only ever carries v1's bytes: the mirror file was never re-saved/re-added after the second
    // publish (plan review, 2026-09-14's "stale-commit revert" scenario).
    tickets.putDocument(SYSTEM_ACTOR, t.id, 'artifact:overview', SAMPLE_HTML_V2, { system: true });
    writeArtifact(t.identifier, 'overview', SAMPLE_HTML);
    const afterSha = await commit('lands carrying only v1\'s stale bytes');

    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);
    expect(tickets.getDocument(t.id, 'artifact:overview')?.revision).toBe(2);
    expect(tickets.getDocument(t.id, 'artifact:overview')?.body).toBe(SAMPLE_HTML_V2);
  });

  it('skips and does not throw when a changed path names a ticket in a different project', async () => {
    const otherProjectId = newId();
    const now = nowIso();
    h.db.insert('projects', {
      id: otherProjectId, workspaceId: h.workspaceId, slug: 'other', name: 'Other', gitUrl: '', defaultBranch: 'main',
      clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: {},
      status: 'ready', createdAt: now, updatedAt: now,
    });
    const foreign = makeTicket(otherProjectId);
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeArtifact(foreign.identifier, 'overview', SAMPLE_HTML);
    const afterSha = await commit('a file naming a ticket from another project');
    await expect(reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha)).resolves.toBeUndefined();
    expect(() => tickets.getDocument(foreign.id, 'artifact:overview')).not.toThrow();
    expect(tickets.getDocument(foreign.id, 'artifact:overview')).toBeNull();
  });

  it('skips and does not throw when a changed path names no ticket at all', async () => {
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeArtifact('TST-999', 'overview', SAMPLE_HTML);
    const afterSha = await commit('a file naming a ticket that was never created');
    await expect(reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha)).resolves.toBeUndefined();
  });

  it('leaves the stored artifact untouched when the file is deleted on the landing branch', async () => {
    const t = makeTicket();
    tickets.putDocument(SYSTEM_ACTOR, t.id, 'artifact:overview', SAMPLE_HTML, { system: true });
    writeArtifact(t.identifier, 'overview', SAMPLE_HTML);
    await commit('add artifact');
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    removeArtifact(t.identifier, 'overview');
    const afterSha = await commit('delete artifact in repo');
    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);
    expect(tickets.getDocument(t.id, 'artifact:overview')?.body).toBe(SAMPLE_HTML);
    expect(tickets.getDocument(t.id, 'artifact:overview')?.revision).toBe(1);
  });

  it('skips a landed body that fails the size/shape validation the publishing tool already applies', async () => {
    const t = makeTicket();
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeArtifact(t.identifier, 'overview', 'not html at all');
    const afterSha = await commit('an invalid landed body');
    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);
    expect(tickets.getDocument(t.id, 'artifact:overview')).toBeNull();
  });

  it("does not touch a different ticket's existing artifact when an unrelated ticket's landing changes only its own path", async () => {
    const a = makeTicket();
    tickets.putDocument(SYSTEM_ACTOR, a.id, 'artifact:overview', SAMPLE_HTML, { system: true });
    writeArtifact(a.identifier, 'overview', SAMPLE_HTML);
    await commit("ticket A's own artifact lands first");

    const b = makeTicket();
    const beforeSha = (await git(['rev-parse', 'HEAD'], clonePath)).stdout.trim();
    writeArtifact(b.identifier, 'plan', SAMPLE_HTML_V2);
    const afterSha = await commit("ticket B's unrelated artifact");

    const changed = await changedArtifactPaths(clonePath, beforeSha, afterSha);
    expect(changed).toEqual([{ ticketIdentifier: b.identifier, key: 'plan', status: 'added' }]);

    await reconcileProjectArtifactsFromRepo(h.ctx, h.deps, project(), beforeSha, afterSha);
    expect(tickets.getDocument(a.id, 'artifact:overview')?.revision).toBe(1);
    expect(tickets.getDocument(b.id, 'artifact:plan')?.body).toBe(SAMPLE_HTML_V2);
  });
});
