## Context

See `proposal.md` — Why. The current implementation (`packages/core/src/knowledge/embeddings.ts`) keeps one latch: `ready`, `failure`, `initializing`. Once `initialize()` fails, `ensure()` returns `null` for the rest of the daemon's life. Two callers read that state: the semantic tool, which throws `OcError('unavailable', …)` (today the only signal), and nothing else — keyword search never consults it.

The live daemon's failure was a first-use model download into `<daemonConfigDir>/embedding-models` that produced no cached file; the same code loaded successfully from a fresh directory on the same host, release, and Node, so the loader itself is sound. What is wrong is the treatment of one failed attempt as a permanent verdict, and the absence of any signal on the keyword path.

## Goals / Non-Goals

- Goal: a transient model-load failure heals without a daemon restart, and no caller is told the capability is gone forever because of one attempt.
- Goal: any caller (or curation) that ends up on keyword search can see, from that tool's own result, that semantic search was unavailable.
- Non-goal: changing the model, the quantization, the chunking, the ranking, or the storage schema.
- Non-goal: warming the model at daemon start-up, or adding a background downloader. The VS-493 invariant that a turn which does not call the tool does no embedding work stays.

## Decisions

### The model-load failure is retryable; the extension failure is not

`initialize()` records a separate `failureKind: 'extension' | 'model' | null` and `failedAt`. `ensure()` becomes:

- ready → return the embedder;
- neither failure → initialize (single-flight as today);
- extension failure → return `null` (latched; a missing native module cannot appear at runtime);
- model failure and `now - failedAt < cooldown` → return `null`;
- model failure and the cooldown elapsed → start a new single-flight `initialize()`.

Cooldown is `min(base * 2^(consecutiveFailures-1), max)` with base 60 s and max 30 min; a success resets the counter. This bounds a network-less daemon to a handful of log lines an hour instead of a retry storm, while letting a curation turn that runs minutes later succeed.

Tests need a clock and an embedder that can fail once and succeed later, so `EmbeddingIndexOptions` gains `loadEmbedder?: () => Promise<Embedder>` (replacing the direct call to `createTransformersEmbedder(cacheDir)`, with `embed` still the constant-embedder seam) and `nowMs?: () => number` and `retryBaseMs?: number`.

*Alternative considered:* keep the latch and hide the tool when unavailable. Rejected: availability cannot be known before an attempt, the tool list is built per MCP session, and hiding a working capability because of one transient failure is worse than retrying. The ticket allows either; the evidence (the loader works on this host) makes "make it work" the honest branch.

*Alternative considered:* warm the model at daemon start. Rejected: it costs a 30 MB download and resident memory on every daemon that never uses the tool, and contradicts the existing requirement and its test that start-up touches neither model nor extension.

### `status()` replaces `available()` + `reason()`

`EmbeddingIndex` gains `status(): { status: 'ready' | 'unavailable' | 'not_loaded'; reason: string | null }`, implemented from the same state without triggering a load. `available()`/`reason()` can be kept as thin wrappers for the existing tests, or folded into `status()`; the service and tool layers use only `status()`.

The status union lives in `packages/shared/src/enums.ts` (`SEMANTIC_SEARCH_STATUSES`) because it crosses the agent-tool boundary, matching the rule that nothing branches on a raw string literal.

### `weave_knowledge_search` wraps its hits, the core service does not

`KnowledgeService.search()` keeps returning `KnowledgeHit[]` so the HTTP route (`packages/server/src/routes/knowledge.ts`) and every existing core caller are untouched. The agent tool handler in `packages/server/src/tools.ts` returns `{ hits, semantic: svc(ctx).knowledge.semanticStatus() }`. This confines the **BREAKING** shape change to the tool contract the ticket asks to make honest, and no model is loaded to answer it.

The tool description and the `weave-ai-knowledge` skill are updated in the same change: the skill tells a curation that if `semantic.reason` is present it must state in the ticket comment that the pass was keyword-only.

### Logging

Each failed model-load attempt logs one warning with the underlying error message, the model id, the cache directory, the attempt number and the next retry time. A recovery logs an info line naming how many attempts failed. The extension failure keeps its single warning.

## Risks / Trade-offs

- [A daemon that can never reach the Hugging Face Hub retries forever] → exponential backoff caps the traffic and log noise at one attempt per 30 minutes; the failure stays visible in every keyword search result, so curation reports it instead of claiming a semantic pass.
- [The tool result shape changes under an agent that parses a bare array] → the skills shipped with the release describe the new shape, the tool description spells it out, and the plan is the human's approval of that contract change.
- [Downloading the model inside a worker's turn blocks that turn for ~7 s on a cold cache] → unchanged from today's design; the alternative (start-up warm-up) was rejected above.

## Migration Plan

No data migration. Deploying the release restarts the daemon by the normal upgrade path, which also clears today's latched failure. Rollback is dropping the two new fields' use in the tool handler; no stored state changes.

## Open Questions

None.
