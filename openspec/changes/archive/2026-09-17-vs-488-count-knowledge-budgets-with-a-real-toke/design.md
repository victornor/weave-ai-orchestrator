## Context

`estimateTokens` (`packages/shared/src/tokens.ts`) is `ceil(Buffer.byteLength(text, 'utf8') / 3.5)`, and 29 call sites depend on it. The consumers fall into four groups:

| Consumer | Site |
|---|---|
| Budget enforcement and the `budget_exceeded` rejection | `packages/core/src/knowledge/service.ts` (`note` :433, `putDoc` :671, `replace` :470, curation triggers :456/:836) |
| Stored/reported sizes | `service.ts` (`ensure` :107, `write` :257, `reindex` :559, `lint` :502, `health` :799), `files.ts` (`sectionSizes` :273) |
| Per-turn inline slice | `packages/core/src/prompts/index.ts` (`boundedTokens` :116, `inlineKnowledge` :127) |
| Bootstrap digest | `service.ts` `bootstrapDigest` :591–636 |
| Other | `packages/core/src/tickets/service.ts:610` (document revision activity) |

The stored size column is what knowledge health, the lint listing, the knowledge UI/CLI and the supervisor's curation sweep read, so replacing the function alone is not enough: the rows already in the database carry byte-ratio numbers.

Measured error of the current heuristic against the real hub files of this workspace's knowledge tree, and against fixtures chosen for where the ratio is worst:

| File / fixture | bytes | old `ceil(b/3.5)` | `o200k_base` | old ÷ true |
|---|---|---|---|---|
| `workspace/WORKSPACE.md` | 9506 | 2716 | 2349 | 1.156 |
| `workspace/SHARED.md` | 3593 | 1027 | 820 | 1.252 |
| `workspace/decisions.md` | 5801 | 1658 | 1260 | 1.316 |
| `projects/agent-conductor/PROJECT.md` | 24084 | 6882 | 6154 | 1.118 |
| prose fixture | 900 | 258 | 201 | 1.284 |
| ts code fence | 60 | 18 | 21 | 0.857 |
| markdown table | 65 | 19 | 25 | 0.760 |
| non-ASCII | 480 | 138 | 125 | 1.104 |
| pretty JSON | 97 | 28 | 34 | 0.824 |

None of the four real hubs is over its real budget under correct counting (PROJECT 6154/10000, SHARED 820/2000, WORKSPACE 2349/10000, decisions 1260/4000). The ticket reports that plainly; no budget constant is touched.

The name `estimateTokens` is kept: it is still an estimate for model families with no public tokenizer, and renaming 29 call sites buys nothing behavioural. Its doc comment changes to say what it now is.

## Decisions

### D1 — Encoding: `o200k_base`, via `js-tiktoken`

`js-tiktoken` is the maintained pure-JS port of OpenAI's `tiktoken`; `getEncoding('o200k_base')` loads its BPE ranks synchronously and `encode(text).length` is the count. `o200k_base` is the most recent widely-used BPE encoding and the best available single proxy for mixed markdown, prose and code.

It is an approximation, and the code says so: Claude, Gemini and Cursor do not publish a tokenizer, and there is no port for them. A per-runtime encoding is deliberately **not** used — the budget is a property of the file, not of who read it, and counting differently per agent would make one file over budget for one worker and under for another. One encoding means one number. The error against a specific family is a fraction of the two-sided 14–32% error of the byte ratio being replaced.

### D2 — Lazy cached singleton, synchronous

A module-level `let encoder: Tiktoken | null`, created on first use with `getEncoding('o200k_base')` and reused. Measured in a scratch install: first call 234 ms, then 0.7–10.6 ms for the four real hubs. The load happens once per process; per-turn cost is the encode itself, which the hot paths already paid as a byte-length call. No async, no worker thread, no cache of counted strings (the inputs change every turn).

### D3 — Truncation is token-aware

`boundedTokens` (`prompts/index.ts:116`) and `bootstrapDigest`'s hard cap (`service.ts:633`) cut at `Math.floor(budget * 3.5)` characters — the byte ratio in disguise, and it defeats the point of a token budget. Both move to a `sliceToTokens(text, budget)` helper: encode, slice the token array, decode, strip any trailing replacement character a partial multi-byte token produces. `sectionSizes` and the budget checks already go through `estimateTokens` and need no shape change.

### D4 — Stored sizes are recomputed, not migrated

No new column and no migration. The count is cheap and `ensure()` already reads each body from disk, so `ensure()` recomputes `token_estimate` and updates the row when it disagrees (the same place that already refreshes `budget_tokens`). `reindex()` recomputes every row regardless of hash. The one consumer that reads `knowledge_files` directly without going through `ensure` is the supervisor's `curationPass` (`supervisor/index.ts:764`); the knowledge service gains a `recountSizes()` that recomputes every visible row's estimate from its content, and the pass calls it before deriving its over-budget verdict. This keeps the sweep's own `curation_pending` cache honest too.

A version stamp would avoid re-tokenizing on every read, but it costs a migration and a schema that has to be maintained for a one-time correction; re-tokenizing a ≤10k-token file is milliseconds and the turn already reads it.

### D5 — Tests

A new `packages/shared/src/tokens.test.ts` pins exact integers for a code fence, a markdown table and non-ASCII text, with a comment recording the encoding and that the numbers were captured from it. It also asserts the byte ratio disagrees with the count on those fixtures, so the old heuristic cannot come back green, and that two calls reuse the same encoder. The knowledge tests that depend on sizes (digest truncation, the "full-size bases" case, `d.tokens` equality) are updated to the real counts; generator helpers that multiply by 3.5 are replaced.

### D6 — No budget constants, no knowledge edits

Enforcing a real count may move a file's percentage of budget, but the budget values (`10000/10000/10000/4000/2000`, bootstrap 16000, inline 4000) are a product decision the ticket puts out of scope. If correct counting suggests one is wrong, that is reported, not changed. No file under `knowledge/` is edited.

## Risks

- **Cross-family accuracy.** `o200k_base` is not any Claude/Gemini tokenizer. Accepted and stated; it is strictly closer than bytes/3.5 for the text this system stores.
- **Bundle weight.** `js-tiktoken` unpacks to ~22 MB of rank data, but only the `o200k_base` ranks load at runtime. The web app never imports `estimateTokens`, and `packages/ui/vite.config.ts` already marks `shared/dist/` side-effect-free for tree-shaking; the tasks verify with a UI build that no `js-tiktoken` chunk appears.
- **First-call latency.** 234 ms once per daemon process. Accepted; it is a one-time cost on the first turn that counts, not per turn.
