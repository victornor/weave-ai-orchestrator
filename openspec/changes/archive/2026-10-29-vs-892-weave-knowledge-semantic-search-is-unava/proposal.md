## Why

`weave_knowledge_semantic_search` has never worked on the live daemon: its one recorded call (2026-10-29 00:29:47, workspace `v-ofm`) returned `unavailable` with transformers.js' terminal "Unable to get model file path or buffer.", and `/home/v/.config/agent-conductor/embedding-models` does not exist, so the weights were never cached. The index latches that failure for the daemon's lifetime, so every later caller is told the capability is gone even after the cause clears. Curation then falls back to keyword search and reports plain success, which is how a knowledge base quietly accumulates the near-duplicates curation exists to remove.

I reproduced the loader on this host with the installed release, its Node, and a fresh cache directory — it loads the model and embeds in ~7s. The loader is not broken; a one-off failure in the first-use download/cache step is being made permanent.

## What Changes

- A model-load failure is no longer remembered forever: the index retries after a bounded cooldown with backoff, so a transient download or provisioning failure heals without a daemon restart. The `sqlite-vec` extension failure stays latched (a missing native module does not appear at runtime).
- The index exposes its state (`ready` / `unavailable` / `not-loaded`) and the last failure reason instead of only `available()` plus a throw.
- **BREAKING** for agent callers: `weave_knowledge_search` returns `{ hits, semantic }` instead of a bare hit array, where `semantic.status` is `ready`, `unavailable` or `not-loaded` and `semantic.reason` carries the load error when unavailable. A caller that fell back to keyword search can therefore see that it did, and a curation can state it.
- The `weave-ai-knowledge` skill and its curation procedure say that a curation which fell back to keyword search must say so in its ticket comment.
- The load-failure log keeps the real underlying error, and a later success records that it recovered after N failed attempts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge/semantic-search`: the degradation requirement changes from "a load failure is logged once and the tool fails until restart" to "a model-load failure is retried after a cooldown and reported honestly"; and a new requirement makes semantic availability visible on `weave_knowledge_search` results.

## Impact

- `packages/core/src/knowledge/embeddings.ts` — retryable model state, status reporting, new test seams.
- `packages/core/src/knowledge/service.ts` and `packages/core/src/api.ts` — expose the embedding index status.
- `packages/server/src/tools.ts` — `weave_knowledge_search` result shape and description; `weave_knowledge_semantic_search` unchanged apart from the improved reason.
- `skills/weave-ai-knowledge/SKILL.md` and `references/curation.md` — say when to disclose the fallback.
- `docs/API.md` (agent tool docs) and `docs/PLAN.md` §9.2 wording if the result shape is documented there.
- Tests in `packages/core/src/knowledge/embeddings.test.ts` and `packages/server` tool tests.
- No schema, model or ranking change; no completed curation is re-run.
