## 1. The tokenizer

- [x] 1.1 Add `js-tiktoken` (`^1.0.21`) to `packages/shared/package.json` and update `pnpm-lock.yaml`; in the worker worktree install with `pnpm add js-tiktoken --filter @weave-ai/shared --store-dir /home/user/.local/share/pnpm/store/v11` (the worktree's pnpm store differs from the host's, VS-420); verify `pnpm install --frozen-lockfile` succeeds and the dependency resolves from `packages/shared`.
- [x] 1.2 Rewrite `estimateTokens` in `packages/shared/src/tokens.ts` to `getTokenizer().encode(text).length`, where `getTokenizer()` lazily creates and caches `getEncoding('o200k_base')`; the doc comment names the encoding, why one encoding is used across the runtimes, that it approximates model families with no public tokenizer, and that it replaced `ceil(bytes/3.5)`; add `sliceToTokens(text, budget)` (encode, slice, decode, strip a trailing replacement char); verify `packages/shared/src/tokens.test.ts` asserts the exact integer counts for a code fence, a markdown table and non-ASCII text, asserts each differs from `Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5)`, and asserts two `getTokenizer()` calls return the same instance.
- [x] 1.3 Verify no byte-ratio or token-to-character conversion survives where a budget is enforced or a slice is cut: `rg -n "3\.5|byteLength" packages/shared/src packages/core/src` returns nothing that turns a token budget into characters or a byte length into tokens.

## 2. Bounding text by tokens

- [x] 2.1 Replace the `Math.floor(budget * 3.5)` character cut in `boundedTokens` (`packages/core/src/prompts/index.ts`) with `sliceToTokens`, keeping the trailing pointer line; verify a test asserts the returned inline text counts at most the inline budget and still contains the truncation pointer.
- [x] 2.2 Replace the `Math.floor(budget * 3.5)` hard cap in `bootstrapDigest` (`packages/core/src/knowledge/service.ts`) with `sliceToTokens`; verify the small-digest-budget test asserts the hard-capped text counts at most the digest budget.

## 3. Honest stored and reported sizes

- [x] 3.1 Recompute `knowledge_files.token_estimate` from the body with `estimateTokens` in `ensure()` (even when the hash is unchanged) and in `reindex()` for every row; add `recountSizes()` to the knowledge service (and its `KnowledgeService` interface in `packages/core/src/api.ts`) recomputing every visible row's estimate from its content; verify a test seeds a row at a byte-ratio estimate, reads or lints it, and asserts the reported size is the tokenizer's count, not the seeded number.
- [x] 3.2 Call `recountSizes()` at the start of the supervisor's `curationPass` (`packages/core/src/supervisor/index.ts`) before the over-budget verdict, so the sweep's `curation_pending`/over-budget decision never derives from a stale byte-ratio row; verify a test with a row carrying a byte-ratio estimate that the pass recomputes it and derives the verdict from the corrected count.
- [x] 3.3 Update the knowledge tests that depend on sizes (`pnpm`-generated line counts, `d.tokens`, digest truncation, the full-size-bases case) to the real counts and remove their `* 3.5` fixture arithmetic; verify `pnpm vitest run packages/core/src/knowledge packages/core/src/prompts` passes.

## 4. Before/after evidence

- [x] 4.1 Count the four real hub files in this workspace's knowledge tree (`workspace/WORKSPACE.md`, `workspace/SHARED.md`, `workspace/decisions.md`, `projects/agent-conductor/PROJECT.md`) with both the old `ceil(bytes/3.5)` and the tokenizer; post the table (bytes, old, true, ratio) on the ticket, state that none of the four is over its real budget under correct counting, and post the same table for the code-fence, table and non-ASCII fixtures.

## 5. Green

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test` from the repo root; paste both suite blocks (core/server and UI) verbatim in the report and confirm all three are green.
- [x] 5.2 Run `pnpm --filter @weave-ai/ui build` and verify the `dist` bundle contains no `js-tiktoken` rank-data chunk, confirming the server-side tokenizer is tree-shaken out of the web app.
