## Context

See `proposal.md` for motivation. The current state that shapes the approach:

- The keyword tool is `weave_knowledge_search` (`packages/server/src/tools.ts:650`), whose handler calls `KnowledgeService.search(query, projectId, limit)` (`packages/core/src/knowledge/service.ts:542`) against the `knowledge_search` FTS5 table, then applies a worker visibility filter in the handler (drops `workspace/WORKSPACE.md`, `workspace/decisions.md`, `workspace/docs/**`). Knowledge service methods are synchronous; server tool handlers may return a promise.
- Knowledge files are markdown hubs and documents in the workspace directory; `entriesOf()` / `parseDoc()` / `sha256()` in `packages/core/src/knowledge/files.ts` already split them into sections/entries and hash content.
- The workspace database is one `node:sqlite` `DatabaseSync` per workspace (`packages/db/src/db.ts`) with WAL, additive SQL migrations under `packages/db/src/migrations/`, and a thin `insert`/`get`/`all`/`run` wrapper. Node 26's `DatabaseSync` exposes `enableLoadExtension()` and `loadExtension()`.
- The knowledge service is created per workspace in `packages/core/src/create.ts:33` with the `WorkspaceContext` (which carries `ctx.db`, `ctx.paths.knowledge`, `ctx.daemonConfigDir`) and a lazy `deps()` accessor.
- Runtime adapters are never shelled out to in tests; core is tested with the fake harness in `packages/core/src/testing/context.ts`, which creates a real temp workspace, a migrated db and a log to a real temp dir.

## Goals / Non-Goals

**Goals:**

- A semantic fallback that finds a knowledge entry when keyword search cannot, with zero cost on any turn that does not call it.
- The smallest possible new surface: one derived table, one tool, no new service, no new route, no new configuration setting.
- Proven scoping parity with keyword search, proven hash-keyed incremental behaviour, proven degradation.

**Non-Goals:**

- Any change to the markdown files, budgets, curation, links or the two injection paths.
- Any approximate index, external vector database, or Python/Node sidecar.
- Automatic extraction of memories from transcripts.
- A configuration flag to disable the feature; the rollback is dropping the table and unregistering the tool.

## Decisions

### D1 — A new capability spec, nothing existing modified

Keyword search has no capability spec of its own (`openspec/specs/knowledge/` covers budgets, health, provenance, curation, documents, graph — not the search tool). Semantic search therefore lands as a new capability, `knowledge/semantic-search`. No existing requirement changes, which is the spec-level expression of "the per-turn path is untouched".

### D2 — Two dependencies, both in `packages/core`

`@huggingface/transformers` (ONNX inference, in-process, no Python) and `sqlite-vec` (a loadable SQLite extension) join `packages/core`'s dependencies. `@huggingface/transformers` is imported only inside a lazy dynamic `import()` in a function that runs on the first real search, so daemon start-up and every non-calling turn pay nothing for it; `sqlite-vec`'s `.so`/`.dylib` is located and loaded lazily and guarded. Both are absent from `packages/ui`, which does not depend on `@weave-ai/core`; the UI bundle verifies this.

Alternatives rejected: computing cosine in plain JS and skipping `sqlite-vec` (the ticket names the extension, and the extension-failure degradation must be real, so the extension is genuinely required); `better-sqlite3` + `sqlite-vec` (the project deliberately uses `node:sqlite`, ADR 0001); any of Mem0/Letta/Graphiti/Cognee (survey; infra weight).

### D3 — Model and weights

Model: `Xenova/bge-small-en-v1.5` (ONNX, 384 dimensions), loaded with a quantized `q8` dtype. Weights come from the Hugging Face Hub on first use, cached under `<ctx.daemonConfigDir>/embedding-models` (outside any release directory, so an upgrade does not delete them), configured through `@huggingface/transformers`' `env.cacheDir`. The exact downloaded artifact and its size on this host are measured in task 5.1 and stated in the delivery; the design is that the cache directory may be pre-seeded for an air-gapped host. At query time nothing touches the network.

The apply task confirms the exact repository id/dtype that resolves and records the byte size; if `Xenova/bge-small-en-v1.5` at `q8` does not resolve, the nearest equivalent 384-dim `bge-small-en-v1.5` ONNX artifact is used and the substitution stated. This cannot change the specs or the task breakdown.

### D4 — Storage: one additive table, vectors as float32 blobs

Migration `packages/db/src/migrations/0048_knowledge_embeddings.sql` adds (numbered `0048` because `0047_thread_message_block.sql` is being built concurrently by VS-491; the branch is rebased onto `main` before delivery so the actual numbers on disk are checked, not assumed):

```
CREATE TABLE knowledge_embeddings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL,
  ref TEXT NOT NULL,            -- knowledge-store-relative path of the source file
  chunk_hash TEXT NOT NULL,     -- sha256 of chunk_text
  chunk_text TEXT NOT NULL,
  section TEXT,
  kind TEXT NOT NULL,           -- 'entry' | 'section' | 'summary'
  dim INTEGER NOT NULL,
  model TEXT NOT NULL,
  vec BLOB NOT NULL,            -- little-endian float32[dim]
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX knowledge_embeddings_ref_hash ON knowledge_embeddings(workspace_id, ref, chunk_hash);
CREATE INDEX knowledge_embeddings_scope ON knowledge_embeddings(workspace_id, project_id);
```

No `vec0` virtual table and no ANN: the corpus is hundreds to low thousands of chunks, and brute force is sub-millisecond. The distance is `sqlite-vec`'s `vec_distance_cosine(vec, ?)` scalar in a single `ORDER BY distance LIMIT ?` query, so the extension is genuinely used and a missing extension is observable. A `vec0` table was rejected because its metadata/scoping columns are clumsier than a plain table with a SQL `WHERE` and because ANN is out of scope anyway. A blob is written from JS as a `Float32Array` buffer; the extension reads that same compact float32 layout.

### D5 — Chunking and content hash: chunks, not files

The unit embedded is a chunk:
- the file's title plus its one-line summary (`docSummary`) as a `summary` chunk;
- one `entry` chunk per `- ` bullet (`entriesOf`), prefixed with its `## section` name so the section is part of what is matched;
- one `section` chunk for a section's non-entry prose lines, when it has any.

Each chunk's key is `sha256(exact chunk_text)`. Because rows are content-addressed, editing one entry inserts one new hash and deletes one old hash; every neighbouring entry's row is untouched. A file-level hash was rejected: it would re-embed the whole file on any edit, which directly contradicts "an edit causes exactly that entry to be re-embedded". The same `sha256` helper the service already uses is reused, applied per chunk.

### D6 — The index is derived and lazy: never a write-path or turn cost

No change is made to `note()`, `replace()`, `putDoc()`, `bootstrapDigest()` or the inline prompt slice. `KnowledgeService.semanticSearch()` first calls the index's `sync()` over the caller's visible files — diffing each file's current chunk hashes against the table, embedding only the missing hashes and deleting rows for hashes no longer present — then embeds the query and runs the distance query. `KnowledgeService.backfillEmbeddings()` runs the same `sync()` and returns `{ embedded, skipped, removed, files }`. This makes backfill idempotent by construction (second run embeds nothing) and makes the first search the only call that pays the full-corpus backfill. Neither the model nor the extension is loaded by `createKnowledgeService`; both load on the first `sync()`/`search()` and are cached for the process.

### D7 — One visibility predicate, shared by both search tools

The keyword handler's worker filter is extracted into one predicate (the ref-prefix exclusions plus the project filter) used by both `weave_knowledge_search` and `weave_knowledge_semantic_search`. Semantic rows carry `project_id` and `ref`, so the same `(project_id = ? OR project_id IS NULL)` selection and the same `ref`-prefix exclusion apply in the SQL/JS path. This is what proves "scoped exactly as the keyword tool": both call the same predicate, and the test drives a query whose global nearest match is in another project/workspace scope and asserts it is filtered.

### D8 — Degradation is an error naming keyword search, never a failed start

The embeddings module exposes `available(): boolean` and throws `OcError('unavailable', <reason; use weave_knowledge_search>)` from `search()` when either the model or the extension failed to load. A load failure logs once at `warn` with the reason and is remembered, so it does not retry every call. Daemon start-up (`createKnowledgeService`) touches neither. The spec's "degraded to keyword search" is the system-level guarantee that keyword search is unaffected; the semantic tool itself returns a typed error rather than silently returning keyword results, so an agent can tell the difference.

### D9 — Test seam: injectable embedder and distance

`createEmbeddingIndex(ctx, { embed?, distance? })` takes an injectable `embed(texts) → Float32Array[]` and `distance` selector. The whole unit suite injects a deterministic fake embedder (a small hashed bag-of-words vector) and a JS cosine, so `pnpm test` never downloads a model and never loads a native extension. A dedicated opt-in test attempts the real `sqlite-vec` load on the host and verifies `vec_distance_cosine` against known vectors, skipping with a clear message when the extension cannot load there; the real transformer path is measured in task 5.1 and not part of the default suite. Degradation is tested by injecting a loader/embedder that throws.

### D10 — Rollback, precisely

Rollback is: `DROP TABLE knowledge_embeddings` (plus its two indexes) and remove `weave_knowledge_semantic_search` from `COMMON_TOOLS`, `PLANNER_TOOLS` and the server registry. No knowledge file, budget, revision, link, FTS row, curation behaviour or injection path ever depended on the table, so nothing else is affected. This is verified in task 5.4 (grep for the table name, suite green with the index disabled).

## Risks / Trade-offs

- **Two heavy dependencies in the daemon's dependency tree** → imported/loaded lazily; measured install and runtime footprint; the UI bundle is checked by a build; a dependency failure degrades rather than crashes.
- **Native `sqlite-vec` or `onnxruntime-node` binary missing on a platform** → guarded load, one clear log, keyword search intact; the feature is simply unavailable there.
- **First search latency** (weight download + model load + full backfill) → lazy, once, and measured; every later search embeds only the query and only newly changed chunks. Numbers are reported, not hidden.
- **Embedding quality is unproven until run** → acceptance requires three real queries on this workspace where keyword returns nothing and semantic returns the right entry; if that cannot be shown, the report says so instead of shipping an unused tool.
- **A model download on an air-gapped host** → pre-seed `<daemonConfigDir>/embedding-models`; without it the tool reports unavailable and keyword search continues.
- **Float32/blob layout mismatch with the extension** → verified by the real-load test and by the query returning the injected nearest chunk; the apply task confirms the exact `vec_distance_cosine` behaviour on this host.
- **Model load holds the event loop on a synchronous ONNX call** → inference runs through the async API and only inside a tool call, never at start-up or in a turn that does not call it; latency is measured and reported so the cost is known.
- **Scope creep into the per-turn path** → the spec forbids it and task 4.2 asserts prompt/digest byte-identity with the capability present but uncalled.

## Migration Plan

1. Additive migration `0048`; an existing database gains one empty table, nothing else. The apply turn rebases onto `main` first and re-checks the highest migration number actually present before creating the file, so a concurrent landing cannot collide with it.
2. Model cache lives under `<daemonConfigDir>/embedding-models`, outside releases, so upgrades keep it.
3. No backfill at deploy: the first semantic search (or an explicit backfill call) builds the index from what is already on disk.
4. Rollback per D10.
5. The human deploys with `weave daemon upgrade` after the merge, as for any daemon change.

## Open Questions

- The exact Hugging Face repository id and dtype that resolves for the quantized 384-dim `bge-small-en-v1.5` artifact, and its byte size, are confirmed at apply time (D3). These do not change the specs, the approach or the task breakdown, only a stated constant in the delivery.
