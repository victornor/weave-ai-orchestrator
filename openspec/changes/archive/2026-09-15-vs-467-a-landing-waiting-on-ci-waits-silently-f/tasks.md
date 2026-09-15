## 1. Forge affordances (re-request a run, runner status)

- [x] 1.1 Add optional `rerunChecks?` and `runnerStatus?` to `ForgeAdapter` in `packages/plugin-sdk/src/index.ts`
- [x] 1.2 Implement both in `packages/core/src/forge/gh.ts`; add the pure `requestedRunnerLabels`/`runnerGaps` helpers and the run/workflow JSON mapping; verify `pnpm vitest run packages/core/src/forge/gh.test.ts`

## 2. Landing path: one safe fresh run for an unusable head

- [x] 2.1 Start one fresh `pull_request` run (an empty trigger commit pushed to the branch) when a CI repository's non-draft head has no usable run and nothing was pushed this attempt; record it through `onChecksRetriggered`, retry a failed trigger up to 3 times, and keep returning `checks_pending`; verify `pnpm vitest run packages/core/src/tickets/archive-before-merge.test.ts`
- [x] 2.2 Prove the route: a `workflow_dispatch` run's checks are absent from the pull request's `statusCheckRollup` (PR #400, head `90a4e44a`: 5 skipped pull_request checks in the rollup, 8 success dispatch checks only in REST), while a real green `pull_request` rollup (PR #396) reads `success`; add both as `gh.test.ts` fixtures

## 3. Supervisor: alarm a stalled merge-slot holder

- [x] 3.1 Add `defaults.mergeChecksAlarmSec` (default 1200) to `packages/shared/src/config.ts`
- [x] 3.2 Raise a throttled conductor alarm with the ticket, PR, head SHA and rollup, clear it when the checks resolve or the ticket leaves the slot, and append the runner-offline line; verify `pnpm vitest run packages/core/src/supervisor/supervisor.test.ts`

## 4. Prove the gate on the four failure-only landings

- [x] 4.1 Add the four recorded rollups (#283, #300, #302, #282) as `gh.test.ts` fixtures mapping to `failure`, and a gate test that a failure on the exact head returns `checks_failed`, never a merge

## 5. Verification

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` green; commit, push, open the PR, record the work product
