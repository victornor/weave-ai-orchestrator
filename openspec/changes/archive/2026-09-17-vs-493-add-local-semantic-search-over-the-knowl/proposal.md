## Why

An agent can find knowledge today only by exact keyword (`weave_knowledge_search`, SQLite FTS) or by following `[[links]]` from a hub. When it knows roughly what it wants but not the words a note used, it finds nothing and writes a duplicate. VS-487's survey found that no comparable coding agent puts embeddings in its automatic context path, and recommended a narrow, agent-invoked semantic fallback instead — and captain chose that full scope on 2026-09-17.

## What Changes

- **A derived `knowledge_embeddings` table** in the existing SQLite database (the connection and file the rest of the schema already uses), keyed on content hash, with an in-process local embedding pipeline: a 384-dimension quantized ONNX model (`Xenova/bge-small-en-v1.5`, q8) run through `@huggingface/transformers`, vectors stored and compared with `sqlite-vec`. Brute-force cosine, never an ANN index or a separate vector database.
- **`weave_knowledge_semantic_search(query, limit?)`**, a sibling to the existing keyword search, scoped exactly as the keyword tool is: a worker can reach only its own project's knowledge plus shared knowledge, never another project's and never workspace-only knowledge; the weaver can reach everything.
- **Content-hash incremental re-embedding.** A chunk whose content is unchanged is never re-embedded; editing one entry re-embeds exactly that entry. The backfill over the existing knowledge tree is idempotent and reports what it embedded.
- **The model runs fully offline at query time** — no API key, no network call on a search once the weights are cached. The weights come from the Hugging Face Hub on first use; on a machine that has never downloaded them and has no network, the feature is unavailable and keyword search still works.
- **The daemon starts and works normally when the model or the extension cannot load** — lazy, guarded loading, a clear log, degraded to keyword search, never a failed start.
- **Nothing in the per-turn injection path changes.** The inline knowledge slice and the bootstrap digest are untouched: the capability costs nothing on a turn that does not call it.
- **Rollback is dropping the table and unregistering the tool**, with the markdown files, budgets, curation contract and injection paths unaffected.

## Capabilities

### New Capabilities

- `knowledge/semantic-search`: an opt-in, agent-invoked semantic fallback over the knowledge base — a local embedding index derived from, and scoped exactly like, the existing keyword search, with content-hash incremental maintenance and graceful degradation to keyword search.

### Modified Capabilities

None. The per-turn injection path, knowledge budgets, the curation contract and every existing knowledge requirement are unchanged.

## Impact

- `packages/core/package.json` — two new runtime dependencies: `@huggingface/transformers` and `sqlite-vec`.
- `packages/core/src/knowledge/embeddings.ts` (new) — chunking, content hashing, the local embedder, the `sqlite-vec` connection, the derived index and its incremental sync/search.
- `packages/core/src/knowledge/service.ts`, `packages/core/src/api.ts` — `KnowledgeService` gains `semanticSearch()` and `backfillEmbeddings()`; the derived index is composed into the knowledge service.
- `packages/db/src/migrations/0048_knowledge_embeddings.sql` (new) — one additive migration for the derived table (`0047` is taken by VS-491's `thread_message_block` migration, in flight).
- `packages/shared/src/tools.ts` — `weave_knowledge_semantic_search` joins `COMMON_TOOLS` and `PLANNER_TOOLS`.
- `packages/server/src/tools.ts` — the new tool's registration and the one shared visibility predicate used by both search tools.
- `docs/PLAN.md`, `docs/API.md`, `skills/weave-ai-knowledge/` — the tool list and the knowledge-reading guidance.
- The web app (`packages/ui`) gains nothing — the model and the extension live in the daemon process only; verified by a build.
