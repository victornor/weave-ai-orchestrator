## 1. Dependencies, migration and the SQLite extension

- [x] 1.1 Add `@huggingface/transformers` and `sqlite-vec` to `packages/core/package.json` dependencies; run `pnpm install`; verify both resolve from the workspace and no type error is introduced (`pnpm typecheck`). Do not import either at module top level.
- [x] 1.2 Rebase onto `main` and check the highest migration number actually present (VS-491 is landing `0047_thread_message_block.sql` concurrently), then add `packages/db/src/migrations/0048_knowledge_embeddings.sql` creating `knowledge_embeddings` with the columns, unique `(workspace_id, ref, chunk_hash)` index and `(workspace_id, project_id)` index from design D4; verify `packages/db/src/migrations.test.ts` still applies every migration on a fresh database and that the table and both indexes exist.
- [x] 1.3 In the new `packages/core/src/knowledge/embeddings.ts`, load the extension lazily and guarded (`db.sqlite.enableLoadExtension(true)` then `loadExtension(<path resolved from the sqlite-vec package>)`), returning `null` and logging once on any failure; verify a unit test that injects a throwing loader reports `available: false` and never throws, and a host test that loads the real extension and asserts `vec_distance_cosine` gives the expected value for two known 384-dim vectors (skipped with a clear message if the extension cannot load on the host).

## 2. The embedding index

- [x] 2.1 Implement the chunker in `embeddings.ts`: a `summary` chunk (title + `docSummary`), one `entry` chunk per `- ` bullet (`entriesOf`) prefixed with its section name, and a `section` chunk for non-entry prose; each chunk carries `sha256(exact chunk_text)`; verify unit tests on a fixture file assert the chunk set, and that editing one entry changes exactly one chunk hash.
- [x] 2.2 Define the `Embedder` interface and the real `createTransformersEmbedder(cacheDir)` that lazy-imports `@huggingface/transformers`, sets `env.cacheDir` to `<ctx.daemonConfigDir>/embedding-models`, and loads `Xenova/bge-small-en-v1.5` at `q8` (dim 384); verify a test injects a fake embedder and asserts the real module is not imported at construction, and a host measurement task (5.1) records the weight size.
- [x] 2.3 Implement `sync(filter)` in `embeddings.ts`: for each visible knowledge file read the body, compute its chunks, insert-or-ignore rows for hashes not yet stored (embedding only those), delete rows for that `ref` whose hash is gone, and return `{ embedded, skipped, removed, files }`; verify a test runs `sync()` twice over an unchanged tree (second run embeds 0), edits one entry (exactly 1 embedded, other rows byte-identical), deletes an entry (its row removed) and adds an entry (1 embedded).
- [x] 2.4 Implement `search(query, { projectId }, limit)` in `embeddings.ts`: embed the query, then select from `knowledge_embeddings` with the same `(project_id = ? OR project_id IS NULL)` rule keyword search uses, `ORDER BY vec_distance_cosine(vec, ?) LIMIT ?`, returning `{ ref, scope, projectId, title, section, kind, chunkText, score }`; verify a test with the fake embedder returns the nearest chunk first and honours the project filter.

## 3. Service surface, the shared visibility predicate and the tool

- [x] 3.1 Add `semanticSearch(query, projectId, limit?)` and `backfillEmbeddings(filter?)` to `KnowledgeService` (`packages/core/src/api.ts`) and compose the index into `createKnowledgeService` (`packages/core/src/knowledge/service.ts`); `semanticSearch` calls `sync()` for the caller's visible files before querying; verify `packages/core/src/knowledge/knowledge.test.ts` asserts a semantic hit and that `backfillEmbeddings()` reports counts and embeds nothing on a second run.
- [x] 3.2 Extract the keyword handler's worker visibility filter into one predicate and apply it to both `weave_knowledge_search` and the new tool in `packages/server/src/tools.ts`; verify a server/tool test asserts a worker's semantic search cannot return another project's entry and cannot return workspace-only knowledge, while the weaver's reaches both.
- [x] 3.3 Register `weave_knowledge_semantic_search` in `packages/server/src/tools.ts` (input `{ query: z.string().min(2), limit?: int 1..50 }`) and add it to `COMMON_TOOLS` and `PLANNER_TOOLS` in `packages/shared/src/tools.ts`; verify `packages/shared/src/tools.test.ts` passes (no unregistered token) and a server test calls the tool as a worker and gets scoped hits.

## 4. Degradation and per-turn invariance

- [x] 4.1 Make a model or extension load failure remember itself, log once at `warn` with the reason, and make `semanticSearch` throw `OcError('unavailable', <reason; use weave_knowledge_search>)`; verify a test injects a failing embedder and a failing extension loader and asserts both the error and that `weave_knowledge_search` and `bootstrapDigest()` still work, and that constructing the knowledge service never imports the model.
- [x] 4.2 Verify the per-turn path is unchanged: extend the prompts test so the rendered bootstrap digest and inline knowledge slice are byte-identical with the semantic capability present but uncalled, and assert no embedder is invoked while building them.

## 5. Measurements, usability and delivery evidence

- [x] 5.1 Measure on this workspace's real knowledge tree and record on the ticket: the exact model repository id and weights size on disk, daemon-process model load time, query embedding time, first-use full-tree backfill/search time, steady-state search time, and the chunk counts per scope.
- [x] 5.2 Run at least three real queries against this workspace's actual knowledge where `weave_knowledge_search` returns nothing and semantic search returns the right entry; paste the queries and both result sets in the report; if this cannot be demonstrated, say so plainly instead of claiming the tool is useful.
- [x] 5.3 Verify the web bundle does not gain the model or the extension: run `pnpm --filter @weave-ai/ui build` and confirm the `dist/` output contains no onnxruntime, model-weight or sqlite-vec asset, recording the build's before/after size.
- [x] 5.4 Verify rollback: grep the tree for `knowledge_embeddings` and assert only the migration and the embeddings module reference it; confirm dropping the table and unregistering the tool leaves `weave_knowledge_search` and the full suite working. State the rollback explicitly in the delivery.

## 6. Docs, skills and green

- [x] 6.1 Update `docs/PLAN.md` §9.2 with the new tool and `docs/API.md` where the tool surface is listed; update `skills/weave-ai-knowledge/SKILL.md` "Reading before writing" and `references/documents.md` to name the semantic fallback for a query that keyword search misses.
- [x] 6.2 Run `pnpm lint`, `pnpm typecheck` and `pnpm test` from the repo root; paste both suite blocks (core/server and UI) verbatim in the report and confirm all three are green.
