## Why

`packages/shared/src/tokens.ts` defines the only token estimate in the system as `ceil(bytes / 3.5)`, and every knowledge budget, reported size, inline slice and bootstrap digest is built on it. A byte ratio is not a token count, and it is wrong in both directions: measured against this workspace's real hub files it overstates prose by 12–32% and understates code fences and markdown tables by 14–24%, so a file reported at 80% of budget may be well over, and a write may be rejected that would have fit. The VS-487 survey named this the foundational fix to make before any other knowledge-base work, because it changes what every other budget number means.

## What Changes

- **`estimateTokens` becomes a real tokenizer.** A lazily-initialized, cached `js-tiktoken` encoder (`o200k_base`) counts the text; the encoding choice, and the fact that workers run on several model families for which no public tokenizer exists, are written down in code rather than implied.
- **Text is bounded by tokens, not characters.** The two places that cut text to a budget — the per-turn inline knowledge slice in `packages/core/src/prompts/index.ts` and the bootstrap digest's hard cap in `packages/core/src/knowledge/service.ts` — cut on the tokenizer's tokens instead of `budget * 3.5` characters.
- **Stored sizes are recomputed.** `knowledge_files.token_estimate` values were produced by the byte ratio; they are recomputed from the file content on read and on `reindex`, and the supervisor's curation sweep recounts before deriving its over-budget verdict, so health, lint, reads and the curation trigger all carry the corrected count.
- **Tests pin real token counts** for a code fence, a markdown table and non-ASCII text — the cases where the byte ratio is most wrong — and fail if the byte ratio returns.
- **A before/after table for this workspace's real hub files** is reported on the ticket.
- No budget constant is changed, and no knowledge file content is edited. If correct counting shows a budget constant is now wrong, it is reported, not adjusted.

## Capabilities

### New Capabilities

- `knowledge/token-counting`: how the daemon counts the tokens a knowledge file, injected slice or bootstrap digest occupies — the tokenizer, the encoding and why one is used, the caching that keeps it cheap per turn, token-based truncation, and the requirement that no stored or reported size is a byte ratio.

### Modified Capabilities

- `knowledge/budgets`: the requirement that a reported size is measured against the configured budget (`The reported size is measured against the configured budget`) now also states that the size is counted with the tokenizer, not estimated from byte length.

## Impact

- `packages/shared/src/tokens.ts` — `estimateTokens` reimplemented; a token-based slice helper added.
- `packages/shared/package.json` + `pnpm-lock.yaml` — the `js-tiktoken` dependency.
- `packages/shared/src/tokens.test.ts` — new; pinned token counts and encoder-caching assertions.
- `packages/core/src/knowledge/service.ts` and `packages/core/src/knowledge/files.ts` — stored estimates recomputed; `sectionSizes` and the digest use the corrected count; a recount exposed for the supervisor sweep.
- `packages/core/src/prompts/index.ts` — the inline slice cut with the tokenizer.
- `packages/core/src/supervisor/index.ts` — the curation pass recounts before its over-budget verdict.
- `packages/core/src/knowledge/knowledge.test.ts` — digest and truncation assertions updated to the real counts.
- `packages/core/src/api.ts` — the knowledge service interface gains the recount.
- The web app never imports `estimateTokens`, so the server-side tokenizer is tree-shaken out of its bundle (verified by a UI build in the tasks).
