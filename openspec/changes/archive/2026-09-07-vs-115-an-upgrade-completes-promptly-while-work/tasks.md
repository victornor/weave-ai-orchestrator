## 1. Data model

- [x] 1.1 Add migration `packages/db/src/migrations/00XX_upgrade_interrupted_runs.sql` adding `interrupted_runs INTEGER` to `upgrades` (same pattern as `0012_upgrade_announcement.sql`'s `drained_runs`); verify `pnpm vitest run packages/db` passes including migration application tests.
- [x] 1.2 Add `interruptedRuns: number | null` to the `Upgrade` interface (`packages/shared/src/types.ts`) and `interrupted: number` to `UpgradeAnnouncement.runs` (same file); verify `pnpm typecheck`.
- [x] 1.3 Drop `'wait_timeout'` from `UPGRADE_FAILURE_REASONS` (`packages/shared/src/enums.ts`) and update `packages/shared/src/enums.test.ts`'s expectation; verify `pnpm vitest run packages/shared`.

## 2. Config defaults

- [x] 2.1 Lower `drainTimeoutSec` and `waitForIdleSec` defaults to `30` in `packages/shared/src/config.ts`, updating both fields' doc comments to reflect that expiry now proceeds rather than fails; verify `pnpm vitest run packages/shared` and update `packages/shared/src/config.test.ts`'s `900`/`3600` expectations to `30`.

## 3. The deferred upgrade proceeds instead of aborting

- [x] 3.1 In `advance()` (`packages/server/src/upgrade.ts`), change the `'timeout'` branch of `waitForIdle` to record `interruptedRuns` (the count from `waitingFor()` at that moment) on the record and fall through to the same build/switch/restart path as `'idle'`, instead of calling `fail(id, 'wait_timeout', ...)` and returning; verify with a rewritten version of `packages/server/test/upgrade.test.ts`'s `'fails with a timeout, resumes dispatch and builds nothing when the wait expires'` test, now asserting the upgrade proceeds to `building`/`switching`/`restarting` and the record carries the interrupted count.
- [x] 3.2 Verify no other code path still branches on `reason === 'wait_timeout'` (grep clean) and that `docs/API.md`'s reason list and `docs/OPERATIONS.md`'s upgrade-stage table are updated to match.

## 4. The chat is told the upgrade has started

- [x] 4.1 In `advance()`, right after `holdDispatch()` is called (before `set(id, { state: 'waiting', ... })`), post one message via `w.services.threads.notifyHuman(...)` to each workspace's primary thread saying the daemon is upgrading and will answer once it is back; verify with a new test in `packages/server/test/upgrade.test.ts` asserting `notifyHuman` (or the fake standing in for it) is called exactly once per upgrade, before the wait resolves.
- [x] 4.2 Confirm (with a test if none already covers it) that a human message enqueued to the conductor's thread while dispatch is held is still stored and its wake still queued — i.e. that nothing about holding dispatch changes `packages/core/src/threads/service.ts`'s `inbound()` behavior; this exercises AC6's "chat's upgrading state" coverage without changing `inbound()` itself unless a gap is found. (Confirmed: `threads.test.ts`'s `'stores an inbound message and wakes the thread agent'` already proves `inbound()` enqueues unconditionally, with no dependency on dispatcher state — no gap, no code or new test needed.)
- [x] 4.3 Update `packages/ui`'s upgrade-facing surfaces if the new `interrupted` count belongs anywhere the drained/resumed counts are already shown (e.g. `Settings.tsx`'s upgrade section); verify with the relevant `packages/ui` test file. (Checked: `packages/ui/src/lib/upgrade.ts` and `Settings.tsx` only ever surface `upgrade.state` via `UPGRADE_STAGE_LABEL` — drained/resumed are not shown anywhere in the web app today, only in the conductor's wake payload/chat summary. Nothing to update.)

## 5. The reported outcome agrees with the running release

- [x] 5.1 Add a read seam to `RunnerIo` (`packages/cli/src/upgrade-runner.ts`), e.g. `alreadyReconciledCompleted(): boolean`, backed by a `SELECT state FROM upgrades WHERE id = ?` against the same `daemon.sqlite` `runUpgradeRunner` already opens; verify the type compiles and the fake in `upgrade-runner.test.ts` implements it. (Named `alreadyCompleted`.)
- [x] 5.2 In `driveRestart`'s polling loop, check `alreadyReconciledCompleted()` alongside the HTTP probe on each iteration; if true, return `{ outcome: 'completed', version: null }` (or read the version some other cheap way already available) without calling `rollbackTo`; verify with a new `upgrade-runner.test.ts` case: the probe never succeeds, but `alreadyReconciledCompleted` flips true partway through the deadline, and the verdict is `completed` with no rollback call recorded.
- [x] 5.3 Guard `recordVerdict`'s writes (`packages/cli/src/upgrade-runner.ts`) with `db.run('UPDATE upgrades SET ... WHERE id = ? AND state = ?', [..., upgradeId, 'restarting'])` instead of `db.update`, so a verdict decided after the row is already terminal is a no-op; verify with a new test: pre-set the row to `completed`, call `recordVerdict` with a `rolled_back` verdict, and assert the row is unchanged.
- [x] 5.4 Verify end-to-end with the existing `'reconciling at startup'` describe block in `packages/server/test/upgrade.test.ts` still passing unmodified (reconcile's own logic does not change) and confirm no regression via `pnpm vitest run packages/server packages/cli`. (414 tests pass, including `upgrade-commands.test.ts`'s deferred-upgrade CLI-follow tests.)

## 6. Documentation

- [x] 6.1 Update `docs/OPERATIONS.md`'s upgrade-stage table, config example (`drainTimeoutSec: 900`/`waitForIdleSec: 3600` → `30`/`30`), and the paragraph contrasting the two paths' interruption behavior (it currently says `update apply` "never interrupts anything — it waits, and fails rather than cut a turn short"; this is no longer true).
- [x] 6.2 Update `docs/API.md`'s `upgrade.reason` enum list to drop `wait_timeout` and document `interruptedRuns`/`runs.interrupted` alongside the existing fields they sit next to.

## 7. Full verification

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm test` all green. (lint clean; typecheck clean; core suite 1616 passed/1 skipped; ui suite 917 passed.)
- [x] 7.2 State in the PR description the new default (30s for both bounds) and the reasoning from design.md decision 2, and note plainly that the real-world "captain's next upgrade on a busy workspace" scenario is not verifiable from this worktree.
