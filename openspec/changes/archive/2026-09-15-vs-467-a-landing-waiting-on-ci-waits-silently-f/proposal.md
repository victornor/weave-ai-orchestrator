## Why

VS-466 makes `attemptArchiveThenMerge` refuse to land a CI repository until the exact landing head has a
completed success. That is the correct safety rule, but it has no bound and no signal: a run that never
starts (an Actions outage, the self-hosted runner offline), a run that is cancelled and never re-runs,
or a head mismatch that never resolves holds the **serial** merge queue indefinitely and nobody is told.
VS-466's audit also found four landings that merged with only a failed `pull_request` run on the merged
head; the new rollup mapping must be shown to reject each of them.

## What Changes

- **Alarm, not a silent wait.** The supervisor's merge-slot poll tracks how long a holder has been
  admitted with unresolved checks. Past a threshold (default 20 minutes, `mergeChecksAlarmSec`) it
  raises one weaver-visible alarm naming the ticket, pull request, head SHA and what the rollup shows.
  It repeats at the same slow cadence, never every poll, and clears as soon as the checks resolve or
  the ticket leaves the merge step.
- **Unstick the common case safely.** When the pull request's head has no `pull_request` run at all
  after it left draft, the landing path asks the forge once to start one (a re-run of an unfinished
  run, or a `workflow_dispatch` of the CI workflow) and records that it did, then keeps waiting. It
  still never merges without a success.
- **Runner-aware alarm.** When the repository's workflows target a self-hosted label that no online
  runner serves, the alarm says so ("no online runner for `weave-ci`"), using GitHub's runners API.
- **Prove the gate on the four failure-only landings.** Each of VS-466's audited heads (#283, #300,
  #302, #282) is replayed through the new rollup mapping and the landing gate and returns a failure
  outcome, never a merge; they are added as fixtures.
- **Tests** for the alarm raise/clear/repeat, the single re-request, the runner-offline message and the
  four replayed rollups.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — a task ticket's tracker change; `skip_specs: true`)

## Impact

- `packages/plugin-sdk/src/index.ts` — two optional `ForgeAdapter` methods.
- `packages/core/src/forge/gh.ts` and a new `packages/core/src/forge/runners.ts` — the re-request and
  runner-status forge calls plus their pure helpers.
- `packages/core/src/tickets/archive-before-merge.ts` — one re-request of a missing run before waiting.
- `packages/core/src/supervisor/index.ts` — the stalled-checks alarm on the merge-slot poll.
- `packages/shared/src/config.ts` — the `mergeChecksAlarmSec` default.
- No schema, route or UI-contract change.
