import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type Db } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from './service.js';
import { chunksOf, createEmbeddingIndex, loadSqliteVecExtension, type Embedder } from './embeddings.js';
import type { Actor, KnowledgeService } from '../api.js';

const WORKER: Actor = { kind: 'agent', id: 'worker-1' };

/** A deterministic local stand-in for the ONNX model: hashed bag-of-words, normalized. */
const DIM = 8;
function vectorOf(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
    v[h % DIM] = (v[h % DIM] ?? 0) + 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm) for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm;
  return v;
}
const fakeEmbed: Embedder = { dim: DIM, model: 'fake', async embed(texts) { return texts.map(vectorOf); } };
const okLoad = (): void => {};

/** Test-only stand-in for `sqlite-vec`: registers the same `vec_distance_cosine` name in plain JS. */
function f32(v: unknown): Float32Array {
  const u = v as Uint8Array;
  return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4);
}
function jsCosine(a: unknown, b: unknown): number {
  const va = f32(a); const vb = f32(b);
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < va.length; i++) { dot += va[i]! * vb[i]!; na += va[i]! ** 2; nb += vb[i]! ** 2; }
  const n = Math.sqrt(na) * Math.sqrt(nb);
  return n ? 1 - dot / n : 1;
}
const udfLoad = (db: Db): void => { db.sqlite.function('vec_distance_cosine', (a, b) => jsCosine(a, b)); };

function projectRow(h: TestHarness, slug: string): string {
  const id = newId();
  const now = new Date().toISOString();
  h.db.insert('projects', {
    id, workspaceId: h.workspaceId, slug, name: slug, gitUrl: `git@example.com:acme/${slug}.git`, defaultBranch: 'main',
    clonePath: join(h.root, slug), maxWorkers: 2, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: now, updatedAt: now,
  });
  return id;
}

describe('knowledge embeddings (VS-493)', () => {
  let h: TestHarness;
  let knowledge: KnowledgeService;

  beforeEach(() => {
    h = makeHarness();
    h.services.projects = { get: () => ({ knowledgeRepoEnabled: false, slug: 'api' }) } as never;
    knowledge = createKnowledgeService(h.ctx, h.deps, { embed: fakeEmbed, loadExtension: udfLoad });
    h.services.knowledge = knowledge;
  });
  afterEach(() => h.cleanup());

  describe('chunksOf', () => {
    it('splits a file into a summary, per-entry chunks and a prose section, keyed on content hash', () => {
      const body = '# Title\n\nintro line.\n\n## A\n- one alpha\n- two beta\n\n## B\nplain prose here\n';
      const chunks = chunksOf(body);
      expect(chunks.map((c) => c.kind)).toEqual(['summary', 'entry', 'entry', 'section']);
      expect(chunks.filter((c) => c.kind === 'entry').map((c) => c.section)).toEqual(['A', 'A']);
    });

    it('changes exactly one chunk hash when one entry is edited', () => {
      const body = '# Title\n\nintro line.\n\n## A\n- one alpha\n- two beta\n\n## B\nplain prose here\n';
      const edited = body.replace('one alpha', 'one gamma');
      const before = chunksOf(body);
      const after = chunksOf(edited);
      const changed = after.filter((c) => !before.some((o) => o.hash === c.hash));
      expect(changed.map((c) => c.kind)).toEqual(['entry']);
      expect(changed[0]!.text).toContain('one gamma');
    });
  });

  describe('incremental sync', () => {
    it('embeds on first backfill, embeds nothing on the second, and reports what it did', async () => {
      knowledge.note(WORKER, 'project', 'Learnings', 'Quartz deployment runs nightly.', h.projectId);
      const first = await knowledge.backfillEmbeddings(h.projectId);
      expect(first.embedded).toBeGreaterThan(0);
      expect(first.files).toBeGreaterThan(0);

      const second = await knowledge.backfillEmbeddings(h.projectId);
      expect(second.embedded).toBe(0);
      expect(second.removed).toBe(0);
      expect(second.skipped).toBeGreaterThan(0);
    });

    it('re-embeds exactly the one new entry when one is added, and removes it when it goes', async () => {
      knowledge.note(WORKER, 'project', 'Learnings', 'Quartz deployment runs nightly.', h.projectId);
      await knowledge.backfillEmbeddings(h.projectId);

      knowledge.note(WORKER, 'project', 'Learnings', 'Widget calibration happens weekly.', h.projectId);
      const added = await knowledge.backfillEmbeddings(h.projectId);
      expect(added.embedded).toBe(1);

      const path = join(h.ctx.paths.knowledge, 'projects/api/PROJECT.md');
      const body = readFileSync(path, 'utf8').replace(/^- \d{4}-\d{2}-\d{2} · Widget calibration happens weekly\.\n?/m, '');
      writeFileSync(path, body, 'utf8');
      const removed = await knowledge.backfillEmbeddings(h.projectId);
      expect(removed.embedded).toBe(0);
      expect(removed.removed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('scoping', () => {
    it('serves only the caller project plus shared, even when another project is indexed', async () => {
      const other = projectRow(h, 'other');
      knowledge.note(WORKER, 'project', 'Learnings', 'Quartz deployment runs nightly.', h.projectId);
      knowledge.note(WORKER, 'project', 'Learnings', 'Zephyr exclusivity clause applies.', other);
      knowledge.note(WORKER, 'shared', 'Conventions', 'House wide: prefer small pull requests.', null);
      await knowledge.backfillEmbeddings(null); // the weaver's view: everything is indexed

      const own = await knowledge.semanticSearch('quartz deployment nightly', h.projectId, 10);
      expect(own.some((hit) => hit.ref.includes('projects/api/'))).toBe(true);
      expect(own.some((hit) => hit.ref.includes('projects/other/'))).toBe(false);

      const all = await knowledge.semanticSearch('zephyr exclusivity clause', null, 10);
      expect(all.some((hit) => hit.ref.includes('projects/other/'))).toBe(true);
      const worker = await knowledge.semanticSearch('zephyr exclusivity clause', h.projectId, 10);
      expect(worker.some((hit) => hit.ref.includes('projects/other/'))).toBe(false);
    });
  });

  describe('degradation and the per-turn path', () => {
    it('the real sqlite-vec extension computes cosine distance on this host', (ctx) => {
      try {
        loadSqliteVecExtension(h.db);
      } catch (e) {
        ctx.skip(`sqlite-vec is not loadable on this host: ${String(e)}`);
        return;
      }
      const a = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
      const b = Buffer.from(new Float32Array([0, 1, 0, 0]).buffer);
      expect(h.db.get<{ d: number }>('SELECT vec_distance_cosine(?,?) AS d', [a, a])!.d).toBeCloseTo(0, 5);
      expect(h.db.get<{ d: number }>('SELECT vec_distance_cosine(?,?) AS d', [a, b])!.d).toBeCloseTo(1, 5);
    });

    it('reports unavailable with the keyword fallback named when the extension cannot load', async () => {
      const index = createEmbeddingIndex(h.ctx, { embed: fakeEmbed, loadExtension: () => { throw new Error('no sqlite-vec here'); } });
      await expect(index.search('anything', { projectId: null, limit: 5 }))
        .rejects.toMatchObject({ code: 'unavailable' });
      await expect(index.search('anything', { projectId: null, limit: 5 }))
        .rejects.toThrow(/weave_knowledge_search/);
      expect(index.available()).toBe(false);
    });

    it('loads neither model nor extension until a call is made', () => {
      let loads = 0;
      const index = createEmbeddingIndex(h.ctx, { embed: fakeEmbed, loadExtension: () => { loads += 1; } });
      expect(index.available()).toBe(false);
      expect(index.reason()).toBeNull();
      expect(index.status()).toEqual({ status: 'not_loaded', reason: null });
      expect(loads).toBe(0);
    });

    it('the knowledge service reports ready after a search and unavailable with the reason after a failed load', async () => {
      knowledge.note(WORKER, 'project', 'Learnings', 'Quartz deployment runs nightly.', h.projectId);
      expect(knowledge.semanticStatus()).toEqual({ status: 'not_loaded', reason: null });
      await knowledge.semanticSearch('quartz deployment', h.projectId, 5);
      expect(knowledge.semanticStatus()).toEqual({ status: 'ready', reason: null });

      const failing = createKnowledgeService(h.ctx, h.deps, {
        loadExtension: udfLoad,
        loadEmbedder: async () => { throw new Error('Unable to get model file path or buffer.'); },
      });
      expect(failing.semanticStatus()).toEqual({ status: 'not_loaded', reason: null });
      await expect(failing.semanticSearch('quartz deployment', h.projectId, 5)).rejects.toMatchObject({ code: 'unavailable' });
      expect(failing.semanticStatus().status).toBe('unavailable');
      expect(failing.semanticStatus().reason).toContain('Unable to get model file path or buffer.');
    });

    it('retries a failed model load after the cooldown and recovers without a restart', async () => {
      let clock = 0;
      let calls = 0;
      const index = createEmbeddingIndex(h.ctx, {
        loadExtension: udfLoad,
        nowMs: () => clock,
        retryBaseMs: 1_000,
        loadEmbedder: async () => {
          calls += 1;
          if (calls === 1) throw new Error('Unable to get model file path or buffer.');
          return fakeEmbed;
        },
      });

      await expect(index.search('anything', { projectId: null, limit: 5 })).rejects.toThrow(/weave_knowledge_search/);
      expect(index.status()).toMatchObject({ status: 'unavailable' });
      expect(index.status().reason).toContain('Unable to get model file path or buffer.');

      // Before the cooldown: the same failure, with no second load attempt.
      await expect(index.search('anything', { projectId: null, limit: 5 })).rejects.toMatchObject({ code: 'unavailable' });
      expect(calls).toBe(1);

      clock = 1_000;
      await index.search('anything', { projectId: null, limit: 5 });
      expect(calls).toBe(2);
      expect(index.status()).toEqual({ status: 'ready', reason: null });
    });

    it('backs off exponentially and caps the wait between model-load retries', async () => {
      let clock = 0;
      let calls = 0;
      const index = createEmbeddingIndex(h.ctx, {
        loadExtension: udfLoad,
        nowMs: () => clock,
        retryBaseMs: 1_000,
        loadEmbedder: async () => {
          calls += 1;
          throw new Error(`download failed ${calls}`);
        },
      });
      const attempt = async (): Promise<void> => {
        await expect(index.search('anything', { projectId: null, limit: 5 })).rejects.toMatchObject({ code: 'unavailable' });
      };

      await attempt(); // failure 1, next retry after 1s
      clock = 500;
      await attempt();
      expect(calls).toBe(1);
      clock = 1_000;
      await attempt(); // failure 2, next retry after 2s
      expect(calls).toBe(2);
      clock = 2_000;
      await attempt();
      expect(calls).toBe(2);
      clock = 3_000;
      await attempt(); // failure 3
      expect(calls).toBe(3);
    });

    it('reports the extension failure as unavailable and keeps it latched', async () => {
      let calls = 0;
      const index = createEmbeddingIndex(h.ctx, {
        embed: fakeEmbed,
        loadExtension: () => { calls += 1; throw new Error('no sqlite-vec here'); },
      });
      await expect(index.search('anything', { projectId: null, limit: 5 })).rejects.toMatchObject({ code: 'unavailable' });
      expect(index.status()).toMatchObject({ status: 'unavailable' });
      expect(index.status().reason).toContain('no sqlite-vec here');
      expect(index.reason()).toContain('no sqlite-vec here');
      await expect(index.search('anything', { projectId: null, limit: 5 })).rejects.toMatchObject({ code: 'unavailable' });
      expect(calls).toBe(1);
    });

    it('never touches the embedder on the turn/boot path', () => {
      let calls = 0;
      const spy: Embedder = { dim: DIM, model: 'spy', async embed(texts) { calls += 1; return texts.map(vectorOf); } };
      const service = createKnowledgeService(h.ctx, h.deps, { embed: spy, loadExtension: okLoad });
      service.bootstrapDigest(h.conductorId);
      service.get('shared');
      expect(calls).toBe(0);
    });
  });
});
