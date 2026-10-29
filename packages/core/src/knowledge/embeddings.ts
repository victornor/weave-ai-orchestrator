import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso, type Db } from '@weave-ai/db';
import { OcError, type KnowledgeScope, type SemanticSearchStatus } from '@weave-ai/shared';
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
 * guarded. An extension failure is remembered and makes semantic search throw `unavailable` (naming
 * the keyword fallback). VS-892: a *model* failure is remembered too, but only until a backoff
 * cooldown elapses, because the model is downloaded from the Hugging Face Hub on first use and one
 * failed download must not disable semantic search for the daemon's lifetime. `status()` reports
 * either state without loading anything, so keyword search can tell its caller it fell back.
 */

/** The local model: 384-dimension `bge-small-en-v1.5` ONNX, quantized. */
export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_DIM = 384;
/** `@huggingface/transformers`' own quantization selector for the ONNX artifact to download. */
export const EMBEDDING_DTYPE = 'q8';
/** VS-892: first model-load retry delay; doubles per consecutive failure, capped by the max. */
export const EMBEDDING_RETRY_BASE_MS = 60_000;
export const EMBEDDING_RETRY_MAX_MS = 30 * 60_000;

export interface Embedder {
  readonly dim: number;
  readonly model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** VS-892: the index's state, readable without triggering a load. */
export interface EmbeddingStatus { status: SemanticSearchStatus; reason: string | null }

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
  /** VS-892: `ready` / `unavailable` / `not_loaded`, plus the last failure reason. Never loads. */
  status(): EmbeddingStatus;
  search(query: string, opts: { projectId: string | null; limit: number }): Promise<SemanticHit[]>;
  backfill(projectId: string | null): Promise<EmbeddingBackfillReport>;
}

export interface EmbeddingIndexOptions {
  /** Test seam: replaces the ONNX model. */
  embed?: Embedder;
  /** VS-892: test seam: replaces `createTransformersEmbedder` so a load can fail and then succeed. */
  loadEmbedder?: () => Promise<Embedder>;
  /** Test seam: replaces the guarded `sqlite-vec` load; throw to simulate a missing extension. */
  loadExtension?: (db: Db) => void;
  /** Overrides `<daemonConfigDir>/embedding-models`, where downloaded weights are cached. */
  cacheDir?: string;
  /** VS-892: test seams for the retry clock and its base delay. */
  nowMs?: () => number;
  retryBaseMs?: number;
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
  const now = opts.nowMs ?? Date.now;
  const retryBaseMs = opts.retryBaseMs ?? EMBEDDING_RETRY_BASE_MS;

  let ready: Embedder | null = null;
  let extensionLoaded = false;
  let extensionFailure: string | null = null;
  let modelFailure: string | null = null;
  let failedAt: number | null = null;
  let failedAttempts = 0;
  let initializing: Promise<Embedder | null> | null = null;

  /** The delay after the latest failed model attempt: base, doubling per consecutive failure. */
  function retryDelayMs(): number {
    return Math.min(retryBaseMs * 2 ** Math.max(failedAttempts - 1, 0), EMBEDDING_RETRY_MAX_MS);
  }

  function retryDue(): boolean {
    return failedAt !== null && now() - failedAt >= retryDelayMs();
  }

  async function initialize(): Promise<Embedder | null> {
    if (!extensionLoaded) {
      try {
        (opts.loadExtension ?? loadSqliteVecExtension)(db);
        extensionLoaded = true;
      } catch (e) {
        extensionFailure = `the sqlite-vec extension could not be loaded (${messageOf(e)})`;
        log.warn({ err: messageOf(e), cacheDir }, 'semantic search unavailable: sqlite-vec failed to load; keyword search is unaffected');
        return null;
      }
    }
    try {
      ready = opts.embed ?? await (opts.loadEmbedder ?? (() => createTransformersEmbedder(cacheDir)))();
      if (failedAttempts > 0) {
        log.info({ model: ready.model, dim: ready.dim, cacheDir, failedAttempts }, 'semantic search model loaded after a failed attempt');
      } else {
        log.info({ model: ready.model, dim: ready.dim, cacheDir }, 'semantic search model loaded');
      }
      modelFailure = null;
      failedAt = null;
      failedAttempts = 0;
      return ready;
    } catch (e) {
      failedAttempts += 1;
      failedAt = now();
      modelFailure = `the embedding model could not be loaded (${messageOf(e)})`;
      log.warn(
        { err: messageOf(e), model: EMBEDDING_MODEL, cacheDir, attempt: failedAttempts, retryInMs: retryDelayMs() },
        'semantic search unavailable: model failed to load; keyword search is unaffected',
      );
      return null;
    }
  }

  /**
   * Lazy and single-flight: the first call loads the extension and the model. An extension failure
   * is latched; a model failure is retried once its backoff cooldown has elapsed, so a transient
   * first-use download failure heals without a daemon restart but does not retry on every call.
   */
  function ensure(): Promise<Embedder | null> {
    if (ready) return Promise.resolve(ready);
    if (extensionFailure) return Promise.resolve(null);
    if (modelFailure && !retryDue()) return Promise.resolve(null);
    if (!initializing) {
      initializing = initialize().finally(() => { initializing = null; });
    }
    return initializing;
  }

  function status(): EmbeddingStatus {
    if (ready) return { status: 'ready', reason: null };
    const failure = extensionFailure ?? modelFailure;
    if (failure) return { status: 'unavailable', reason: failure };
    return { status: 'not_loaded', reason: null };
  }

  function requireReady(embed: Embedder | null): Embedder {
    if (embed) return embed;
    const failure = extensionFailure ?? modelFailure;
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
    reason: () => extensionFailure ?? modelFailure,
    status,

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
