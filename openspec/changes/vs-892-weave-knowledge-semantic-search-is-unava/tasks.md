## 1. Retryable model load

- [ ] 1.1 In `packages/core/src/knowledge/embeddings.ts`, split the latched failure into an extension failure (latched) and a model failure with `failedAt` and a consecutive-failure counter, and make `ensure()` retry the model load once the exponential cooldown (60 s base, 30 min cap, reset on success) has elapsed. Verify with new unit tests: a load that fails once and then succeeds returns hits after the cooldown, and a second call before the cooldown returns the same failure with no further load attempt.
- [ ] 1.2 Add the `loadEmbedder`, `nowMs` and `retryBaseMs` seams to `EmbeddingIndexOptions` and use them in `initialize()`, keeping `embed` as the constant-embedder seam. Verify the existing `embeddings.test.ts` suite still passes unchanged.
- [ ] 1.3 Log each failed model attempt with the underlying error, model id, cache directory, attempt number and next retry time, and log the recovery with the number of failed attempts. Verify by asserting the log calls in the retry test.

## 2. Status reporting

- [ ] 2.1 Add `SEMANTIC_SEARCH_STATUSES = ['ready', 'unavailable', 'not_loaded']` (with its type) to `packages/shared/src/enums.ts`, and add `status()` to `EmbeddingIndex` returning the status plus the last failure reason without triggering a load. Verify with a unit test that a fresh index reports `not_loaded` with a null reason and that no embedder or extension call happens.
- [ ] 2.2 Expose the index status through `KnowledgeService` (`semanticStatus()` in `packages/core/src/api.ts` and `service.ts`). Verify the core typecheck passes and a unit test shows `ready` after a successful search and `unavailable` with the reason after a failed load.

## 3. Keyword search reports the fallback

- [ ] 3.1 In `packages/server/src/tools.ts`, make `weave_knowledge_search` return `{ hits, semantic }` using `semanticStatus()`, and update its description to name the three statuses. Verify with a tools test that the result carries `hits` plus the status, and that calling it on a daemon that never used semantic search leaves the model unloaded.
- [ ] 3.2 Verify the HTTP knowledge route (`packages/server/src/routes/knowledge.ts`) still returns the bare hit array and its tests pass unchanged.

## 4. Tell the caller

- [ ] 4.1 Update `skills/weave-ai-knowledge/SKILL.md` and `skills/weave-ai-knowledge/references/curation.md` so a curation that received `semantic.status: "unavailable"` must state in its ticket comment that the pass was keyword-only. Verify the wording by re-reading both files and checking `skills/manifest.json` needs no change.
- [ ] 4.2 Update the agent-tool documentation in `docs/API.md` (and the `docs/PLAN.md` §9.2 sentence if it describes the keyword result) to the new result shape. Verify with `rg` that no doc still describes keyword search as returning a bare array.

## 5. Suite

- [ ] 5.1 Run `pnpm lint && pnpm typecheck` and the affected vitest files, then the full `pnpm test`, and paste both suite blocks verbatim in the report. Verify both blocks are green.
