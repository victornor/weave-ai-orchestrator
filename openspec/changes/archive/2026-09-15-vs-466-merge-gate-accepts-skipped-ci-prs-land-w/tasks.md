## 1. Rollup: a skipped check is not a pass

- [x] 1.1 Make `checkState`/`checkTally`/`rollupState` in `packages/core/src/forge/gh.ts` ignore `SKIPPED`, and map `NEUTRAL`/`CANCELLED`/in-progress/missing to not-passed; verify with `pnpm vitest run packages/core/src/forge/gh.test.ts`
- [x] 1.2 Add gh.test.ts cases: an all-skipped rollup is `none` not `success`; a rollup with skipped duplicates plus successes is `success`; cancelled/neutral/in-progress are not `success`; verify the named tests pass

## 2. Gate: exact head SHA and never merge a CI repo on an absent rollup

- [x] 2.1 In `attemptArchiveThenMerge`, read the scratch worktree's `HEAD` after any push and return `checks_pending` when `prState.headSha` differs; verify with an `archive-before-merge.test.ts` case whose fake forge reports a mismatched `headSha`
- [x] 2.2 Return `checks_pending` rather than falling through when `hasCiWorkflows === true` and the rollup is `none`; keep `false` merging and the `null` grace; verify `archive-before-merge.test.ts` covers accept-success, reject-none-with-CI, and the no-CI merge

## 3. Landing sequence: one non-draft push

- [x] 3.1 Move `markPullRequestReady` before the rebase/archive push in `attemptArchiveThenMerge`; verify with a test asserting the remote branch advances only after the ready call, and update the existing order assertion if needed
- [x] 3.2 Confirm `pnpm vitest run packages/core/src/tickets/archive-before-merge.test.ts` passes, including the VS-393 draft/absence cases

## 4. Audit and verification

- [x] 4.1 List every PR merged in the last 7 days whose merged head had no successful required-job run, and put it in the ticket `report` document
- [x] 4.2 Trigger a CI run on current `main` (`gh workflow run`) and report it green or red in the same document
- [x] 4.3 `pnpm lint && pnpm typecheck && pnpm test` green; commit, push, open the PR, record the work product
