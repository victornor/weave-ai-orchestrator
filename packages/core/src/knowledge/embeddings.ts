import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso, type Db } from '@weave-ai/db';
import { OcError, type KnowledgeScope } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import { docSummary, docTitle, parseDoc, sha256 } from './files.js';

/**
 * VS-493: a derived, content-hash keyed index of knowledge chunks for opt-in semantic search.
 *
 * It is built only by reading the existing markdown knowledge tree — nothing on the write path or in
 * the per-turn injection path touches it. The vectors live in the workspace's own SQLite database
 * (`knowledge_embeddings`, migration 0048) and are compared with `sqlite-vec`'s brute-force
 * `vec_distance_cosine`; there is no server, no sidecar, no second database and no ANN index.
 *
 * Both the SQLite extension and the embedding model are loaded lazily on the first real call and
 * guarded: a failure is remembered, logged once, and makes semantic search throw `unavailable`
 * (naming the keyword fallback) rather than disturbing the daemon or keyword search.
 */

/** The local model: 384-dimension `bge-small-en-v1.5` ONNX, quantized. */
export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_DIM = 384;
/** `@huggingface/transformers`' own quantization selector for the ONNX artifact to download. */
export const EMBEDDING_DTYPE = 'q8';

export interface Embedder {
  readonly dim: number;
  readonly model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface SemanticHit {
  ref: string; scope: KnowledgeScope; projectId: string | null; title: string;
  section: string | null; kind: ChunkKind; text: string; score: number;
}
export interface EmbeddingBackfillReport { embedded: number; skipped: number; removed: number; files: number }
export type ChunkKind = 'summary' | 'entry' | 'section';
export interface Chunk { kind: ChunkKind; section: string | null; text: string; hash: string }

export interface EmbeddingIndex {
  /** True once the extension and the model have both loaded — never true before the first call. */
  available(): boolean;
  reason(): string | null;
  search(query: string, opts: { projectId: string | null; limit: number }): Promise<SemanticHit[]>;
  backfill(projectId: string | null): Promise<EmbeddingBackfillReport>;
}

export interface EmbeddingIndexOptions {
  /** Test seam: replaces the ONNX model. */
  embed?: Embedder;
  /** Test seam: replaces the guarded `sqlite-vec` load; throw to simulate a missing extension. */
  loadExtension?: (db: Db) => void;
  /** Overrides `<daemonConfigDir>/embedding-models`, where downloaded weights are cached. */
  cacheDir?: string;
}

/** One float32 little-endian blob, the compact layout `sqlite-vec`'s distance functions read. */
function blob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Split a knowledge file into the chunks that get embedded, keyed on the hash of the exact chunk
 * text. A bullet entry is one chunk, a section's non-entry prose is one chunk, and the file's title
 * plus one-line summary is one chunk — so editing a single entry re-embeds only that entry.
 */
export function chunksOf(body: string): Chunk[] {
  const doc = parseDoc(body);
  const title = docTitle(body);
  const summary = docSummary(body);
  const summaryText = [title, summary].filter((s): s is string => Boolean(s && s.trim())).join('\n');
  const out: Chunk[] = [];
  const push = (kind: ChunkKind, section: string | null, text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    out.push({ kind, section, text: trimmed, hash: sha256(trimmed) });
  };
  if (summaryText.trim()) push('summary', null, summaryText);
  for (const s of doc.sections) {
    const entries: string[] = [];
    const prose: string[] = [];
    for (const line of s.lines) {
      if (/^\s*[-*]\s+/.test(line)) entries.push(line.trimEnd());
      else {
        const t = line.trim();
        if (t && !/^<!--/.test(t)) prose.push(line.trimEnd());
      }
    }
    for (const e of entries) push('entry', s.name, `## ${s.name}\n${e}`);
    if (prose.length) push('section', s.name, `## ${s.name}\n${prose.join('\n')}`);
  }
  return out;
}

/** The `sqlite-vec` loadable extension, resolved from the package the daemon depends on. */
export function loadSqliteVecExtension(db: Db): void {
  const require = createRequire(import.meta.url);
  const { getLoadablePath } = require('sqlite-vec') as { getLoadablePath(): string };
  db.sqlite.loadExtension(getLoadablePath());
}

/** The real embedder: `@huggingface/transformers` in-process, cached on disk, no API key. */
export async function createTransformersEmbedder(cacheDir: string): Promise<Embedder> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.allowRemoteModels = true;
  type FeatureExtractor = (texts: string[], opts: { pooling: 'cls'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
  const extractor = (await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE })) as unknown as FeatureExtractor;
  return {
    dim: EMBEDDING_DIM,
    model: EMBEDDING_MODEL,
    async embed(texts) {
      const out = await extractor(texts, { pooling: 'cls', normalize: true });
      return out.tolist().map((row) => Float32Array.from(row));
    },
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface FileRow { id: string; projectId: string | null; scope: KnowledgeScope; path: string }

export function createEmbeddingIndex(ctx: WorkspaceContext, opts: EmbeddingIndexOptions = {}): EmbeddingIndex {
  const db = ctx.db;
  const ws = ctx.workspaceId;
  const log = ctx.log('knowledge');
  const cacheDir = opts.cacheDir ?? join(ctx.daemonConfigDir, 'embedding-models');

  let ready: Embedder | null = null;
  let failure: string | null = null;
  let initializing: Promise<Embedder | null> | null = null;

  async function initialize(): Promise<Embedder | null> {
    try {
      (opts.loadExtension ?? loadSqliteVecExtension)(db);
    } catch (e) {
      failure = `the sqlite-vec extension could not be loaded (${messageOf(e)})`;
      log.warn({ err: messageOf(e), cacheDir }, 'semantic search unavailable: sqlite-vec failed to load; keyword search is unaffected');
      return null;
    }
    try {
      ready = opts.embed ?? await createTransformersEmbedder(cacheDir);
      log.info({ model: ready.model, dim: ready.dim, cacheDir }, 'semantic search model loaded');
      return ready;
    } catch (e) {
      failure = `the embedding model could not be loaded (${messageOf(e)})`;
      log.warn({ err: messageOf(e), model: EMBEDDING_MODEL, cacheDir }, 'semantic search unavailable: model failed to load; keyword search is unaffected');
      return null;
    }
  }

  /** Lazy and single-flight: the first call loads the extension and the model; a failure is remembered. */
  function ensure(): Promise<Embedder | null> {
    if (ready) return Promise.resolve(ready);
    if (failure) return Promise.resolve(null);
    if (!initializing) initializing = initialize();
    return initializing;
  }

  function requireReady(embed: Embedder | null): Embedder {
    if (embed) return embed;
    throw new OcError('unavailable', `semantic search is unavailable: ${failure ?? 'it has not been initialised'}. Use weave_knowledge_search instead.`, { reason: failure ?? 'not initialised' });
  }

  /** The caller's visible knowledge files: their own project plus unscoped (shared) files. */
  function visibleFiles(projectId: string | null): FileRow[] {
    const params: Array<string | null> = [ws];
    let sql = 'SELECT id, project_id AS projectId, scope, path FROM knowledge_files WHERE workspace_id = ?';
    if (projectId) { sql += ' AND (project_id = ? OR project_id IS NULL)'; params.push(projectId); }
    return db.all<FileRow>(sql, params);
  }

  /**
   * Diff each visible file's current chunks against the stored rows: embed only the missing hashes,
   * delete rows for content that is gone, leave every unchanged row byte-identical. Idempotent.
   */
  async function sync(embed: Embedder, projectId: string | null): Promise<EmbeddingBackfillReport> {
    let embedded = 0;
    let skipped = 0;
    let removed = 0;
    let files = 0;
    for (const file of visibleFiles(projectId)) {
      const abs = join(ctx.paths.knowledge, file.path);
      if (!existsSync(abs)) continue;
      files += 1;
      const body = readFileSync(abs, 'utf8');
      const chunks = chunksOf(body);
      const title = docTitle(body) ?? file.path;
      const existing = new Set(db.all<{ chunkHash: string }>(
        'SELECT chunk_hash AS chunkHash FROM knowledge_embeddings WHERE workspace_id = ? AND ref = ?', [ws, file.path],
      ).map((r) => r.chunkHash));
      const present = new Set(chunks.map((c) => c.hash));
      const missing = chunks.filter((c) => !existing.has(c.hash));
      skipped += chunks.length - missing.length;
      if (missing.length) {
        const vectors = await embed.embed(missing.map((c) => c.text));
        db.transaction(() => {
          missing.forEach((c, i) => {
            const vec = vectors[i];
            if (!vec) return;
            db.run(
              'INSERT OR IGNORE INTO knowledge_embeddings (id, workspace_id, project_id, scope, ref, title, chunk_hash, chunk_text, section, kind, dim, model, vec, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              [newId(), ws, file.projectId, file.scope, file.path, title, c.hash, c.text, c.section, c.kind, embed.dim, embed.model, blob(vec), nowIso()],
            );
          });
        });
        embedded += missing.length;
      }
      for (const hash of existing) {
        if (present.has(hash)) continue;
        db.run('DELETE FROM knowledge_embeddings WHERE workspace_id = ? AND ref = ? AND chunk_hash = ?', [ws, file.path, hash]);
        removed += 1;
      }
    }
    return { embedded, skipped, removed, files };
  }

  return {
    available: () => ready !== null,
    reason: () => failure,

    async search(query, o) {
      const embed = requireReady(await ensure());
      await sync(embed, o.projectId);
      const [queryVec] = await embed.embed([query]);
      if (!queryVec) return [];
      const params: Array<string | number | null | Uint8Array> = [blob(queryVec), ws];
      let sql = 'SELECT ref, project_id AS projectId, scope, title, section, kind, chunk_text AS chunkText, vec_distance_cosine(vec, ?) AS distance FROM knowledge_embeddings WHERE workspace_id = ?';
      if (o.projectId) { sql += ' AND (project_id = ? OR project_id IS NULL)'; params.push(o.projectId); }
      sql += ' ORDER BY distance ASC LIMIT ?';
      params.push(Math.min(o.limit, 100));
      return db.all<{ ref: string; projectId: string | null; scope: KnowledgeScope; title: string; section: string | null; kind: ChunkKind; chunkText: string; distance: number }>(sql, params)
        .map((r) => ({ ref: r.ref, scope: r.scope, projectId: r.projectId, title: r.title, section: r.section, kind: r.kind, text: r.chunkText, score: 1 - r.distance }));
    },

    async backfill(projectId) {
      const embed = requireReady(await ensure());
      return sync(embed, projectId);
    },
  };
}
