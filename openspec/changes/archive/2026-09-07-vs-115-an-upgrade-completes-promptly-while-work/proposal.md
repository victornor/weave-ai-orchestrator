## Why

Tonight, on a busy workspace, the deferred upgrade (`update apply`) sat in `waiting` for up to
`waitForIdleSec` (3600s) because tickets were stuck, holding every workspace's dispatch — including the
conductor's — the whole time, so a chat message sent during that window got no reply and no explanation.
The human worked around it with the local `daemon upgrade --drain-timeout 5`, whose own default
(`drainTimeoutSec`, 900s) is one root of the same problem. Separately, the deferred upgrade's restart
runner raced the daemon's own boot-time reconciliation and overwrote a correctly-recorded `completed` row
with `failed`, then rolled the release back — while the new release had in fact already been serving
successfully. Whatever the outcome, the reported outcome and the running release must agree.

## What Changes

- **Bounded wait, not a bounded failure.** `waitForIdleSec` (deferred upgrade) currently fails the whole
  upgrade when its wait expires — `advance()` gives up, resumes dispatch, and nothing is built. It now
  proceeds to build/switch/restart once the bound expires, exactly as it already does when idle is reached
  naturally. Turns still executing when the eventual restart happens are handled the way a daemon restart
  already handles any in-flight turn today — `bootRecovery` kills, marks `interrupted`, and re-queues them,
  and this already works (three runs resumed this way tonight). No new interruption mechanism is added;
  the deferred upgrade is just no longer forbidden from using the one that exists.
- **Both bounds default short.** `waitForIdleSec` and `drainTimeoutSec` both drop from 3600s/900s to 30s
  default. Both stay overridable per invocation (`--drain-timeout`, `daemon.yaml`, unchanged). See
  design.md for the reasoning.
- **`wait_timeout` is retired** as an `UpgradeFailureReason` — the state it named can no longer be reached,
  since the wait no longer fails the upgrade. A new `interruptedRuns` count on the record (alongside the
  existing `drainedRuns`) says how many turns were still executing when the bound expired and the upgrade
  proceeded anyway; it is `0` in the common case where the wait was never needed.
- **The chat is told the upgrade has started**, not only that it has finished. As soon as dispatch is held
  for a deferred upgrade, one line is posted on the workspace's primary chat thread — the same channel path
  the existing "back up" announcement already uses — saying the daemon is upgrading and will answer once
  it is back. A message the human sends during the hold is unaffected: it is already durably queued today
  and is dispatched once the upgrade resumes or completes; this change only adds the explanation that was
  missing, not new delivery.
- **The reported outcome always agrees with what is running.** The restart runner's health-probe loop
  (`driveRestart`) now also checks whether the daemon's own boot-time reconciliation has already recorded
  the upgrade as `completed` — a fact the runner's process can read but the daemon's process, being the
  authority on its own release, can decide faster and more reliably than an HTTP probe can confirm it. If
  reconciliation already got there first, the runner stops without rolling back a release that is in fact
  serving successfully. `recordVerdict` additionally only writes when the record is still `restarting`, so
  a race can no longer silently overwrite an already-terminal outcome either way.

## Capabilities

### Modified Capabilities
- `daemon-upgrade/deferred-upgrade`: the wait-for-idle bound proceeds instead of failing; the restart
  verification no longer lets a stale health-probe verdict override a reconciliation that already
  completed; new `interruptedRuns` record field.
- `daemon-upgrade/upgrade-announcement`: a new chat message when the upgrade starts holding dispatch, and
  the "runs" figures in the completion announcement gain the interrupted count.

## Impact

- `packages/shared/src/config.ts` (defaults), `packages/shared/src/enums.ts` (drop `wait_timeout`),
  `packages/shared/src/types.ts` (`interruptedRuns`, announcement `runs.interrupted`).
- `packages/server/src/upgrade.ts` (`advance()`'s timeout branch, the new starting notice).
- `packages/server/src/upgrade-announce.ts` (`runs.interrupted` in the built announcement).
- `packages/cli/src/upgrade-runner.ts` (`driveRestart`'s exit condition, `recordVerdict`'s guard).
- `packages/cli/src/commands/daemon.ts`, `packages/shared/src/config.test.ts`,
  `packages/server/test/upgrade.test.ts`, `packages/cli/src/upgrade-runner.test.ts`,
  `packages/shared/src/enums.test.ts` — defaults and behavior changes need matching test updates.
- `docs/OPERATIONS.md`, `docs/API.md` — the two config defaults and the `wait_timeout` reason are
  documented there and need updating alongside the code.
