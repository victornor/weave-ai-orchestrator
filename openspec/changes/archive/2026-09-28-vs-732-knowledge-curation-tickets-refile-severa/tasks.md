## 1. Per-scope cap in the knowledge service

- [x] 1.1 Add `CURATION_MIN_INTERVAL_MS` (24 h) to `packages/core/src/knowledge/files.ts` beside `CURATION_BUDGET_FRACTION`, with a comment giving the reasoning; verify `pnpm --filter @weave-ai/core exec tsc -b` (or root `pnpm typecheck`) compiles and the constant is exported.
- [x] 1.2 Add an optional `{ force?: boolean }` argument and the cap to `KnowledgeService.requestCuration` in `packages/core/src/knowledge/service.ts`: skip and return an empty result when a curation for the scope + project is open, or when one was requested/completed within `CURATION_MIN_INTERVAL_MS`, unless `force` is set; stamp the per-scope `meta:knowledge:curation_at:<scope>:<projectId>` time when a request is honored and log the skip reason; verify with `knowledge.test.ts` cases for manual bypass, over-budget bypass, the soft over-share condition respecting the interval, a second call inside the interval filing nothing, and a different project filing normally.
- [x] 1.3 Update the `requestCuration` signature in `packages/core/src/api.ts` and pass `force: true` from the manual route in `packages/server/src/routes/knowledge.ts`; verify the server route test and `pnpm typecheck` pass.
- [x] 1.4 Make `fireCuration` in `service.ts` pass `force: true` from the hard over-budget rejection in `note()` and the over-budget `replace()` path, and leave the soft 80 % `note()` path unforced; verify `knowledge.test.ts` asserts both the rejected write inside the interval files and the accepted over-share write inside the interval does not.

## 2. Scope-wide freshness reset on a completed curation

- [x] 2.1 In `write()` (`service.ts`), when `reason === 'curation'`, set `last_curated_at` to now for every file in the same scope and project (the predicate that already clears `curation_pending`), leaving `updated_at` untouched; verify a `knowledge.test.ts` case seeds a second document in the scope, runs a curation replace on the hub, and asserts the second document's `last_curated_at` moved and the supervisor's staleness verdict is false for it.

## 3. Collapse the per-file sweep into one request per scope

- [x] 3.1 Rework `curationPass` in `packages/core/src/supervisor/index.ts` to group qualifying rows by `(scope, projectId)`, make one `requestCuration` call per group, and log every qualifying file with its own evidence; remove the per-path `supervisor:curation_requested:*` stamp and `CURATION_REQUEST_COOLDOWN_MS`; verify `supervisor.test.ts` shows several stale files in one project producing one `requestCuration` call, two projects producing two, and each qualifying file present in the log fields.
- [x] 3.2 Update the existing supervisor curation tests that assert per-file/per-path behaviour to the new scope-level behaviour, and keep the over-budget, staleness, never-read and missing-file scenarios covered; verify `pnpm vitest run packages/core/src/supervisor` is green.

## 4. Regression and full verification

- [x] 4.1 Add a `knowledge.test.ts` case proving a bypass (manual or over-budget) while a curation for the scope is already open does not create a second one; verify the case fails if the open-ticket check is removed.
- [x] 4.2 Run the targeted suites, then the full suite, and paste both suite blocks verbatim in the PR: `pnpm lint && pnpm typecheck && pnpm vitest run packages/core && pnpm test`; confirm no test starts or stops the live daemon and `git status --porcelain` in the worktree is empty after committing.
