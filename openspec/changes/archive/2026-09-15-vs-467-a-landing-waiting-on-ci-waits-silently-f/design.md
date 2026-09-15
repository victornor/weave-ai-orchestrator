## Context

After VS-466 the landing gate (`attemptArchiveThenMerge`, `packages/core/src/tickets/archive-before-merge.ts`)
returns the retryable `checks_pending` whenever a CI repository's exact landing head has no completed
success. The merge queue is serial (`mergeConcurrency` default 1) and a holder in `merging` with a
non-null `merge_started_at` owns the slot; `packages/core/src/supervisor/index.ts` already polls that
holder's pull request every 30 s (`wakeMergingOnProgress`) to wake its worker when checks resolve. What
is missing is a bound and a signal when they never resolve.

## Decisions

### 1. The alarm is a supervisor pass, not a landing-path throw

The landing path is retried by a worker and never sees time; the supervisor already polls the slot and
keeps state between turns. So the alarm lives in `wakeMergingOnProgress`, which already has the ticket
row, the project clone and the forge's `prState`.

- **Threshold and cadence**: one config default, `defaults.mergeChecksAlarmSec` (1200 s). The first
  alarm fires once the holder has been admitted longer than the threshold; repeats fire no more often
  than the threshold again. One knob rather than two, named in `WorkspaceDefaultsSchema`.
- **What counts as waiting**: the rollup is not `success` and not `failure` — i.e. `pending` (a run is
  running) or `none` (no rollup, every check skipped/cancelled, or a head the gate will not accept).
  A `failure` is not a stalled wait: the worker gets a wake and fixes it.
- **Clear**: on `success`/`failure`, or when the ticket is no longer a member of the polled set (it
  landed, was withdrawn or moved out of `merging`). The per-ticket entry keyed by ticket id is dropped
  at the end of each pass for every id not seen.
- **Delivery**: a conductor (`deps().workers.conductor()`) wake with `source: 'system'` — the plan's
  existing "alarm" path, e.g. VS-461's watchdog — plus a durable ticket comment and a `log.warn`. The
  wake's idempotency key carries the alarm epoch so a repeat is not deduped away. Evidence payload:
  ticket, pull request, head SHA, `ciState`, check tally.

### 2. One safe fresh run for an unusable head

`attemptArchiveThenMerge` starts a fresh `pull_request` run at most once per pull request when
`ciState === 'none'` on a repository the forge says has CI (`hasWorkflows === true`), the pull request
is out of draft, and **nothing was pushed this attempt** (a fresh draft's own `ready_for_review`
transition already starts one). `GhForge.hasUsableCheckRun` decides whether a run is coming or has
resolved; only `false` (no `pull_request` run at all, or only `skipped`/`cancelled`/`startup_failure`
ones) triggers. The trigger is an **empty commit pushed to the branch** — a `pull_request`
`synchronize` event on the non-draft pull request — recorded through `onChecksRetriggered`. The gate
still returns `checks_pending` and never merges. A failed trigger is retried on a later attempt, capped
at `MAX_RETRIGGER_ATTEMPTS` (3); a forge that cannot say (`null`) is never triggered on.

**Why not a `workflow_dispatch` or a re-run** (the ticket's suggested examples), verified on this
repository 2026-09-15:

- A `workflow_dispatch` run's check runs are attached to the commit (REST
  `commits/<sha>/check-runs`) but are **absent from the pull request's `statusCheckRollup`**, which is
  the field the gate reads. On PR #400, head `90a4e44a`, the rollup held only the 5 `skipped`
  `pull_request` checks while REST showed the `workflow_dispatch` run 34923168865's 8 `success`
  checks on the same SHA. A green dispatch run would therefore never satisfy the gate.
- `POST …/runs/<id>/rerun` re-evaluates the run's original event payload, so re-running a run created
  while the pull request was a draft skips every job again (`ci.yml`'s draft guard). A `synchronize`
  push is the only route whose run is both non-draft and PR-associated.

So a `rerunChecks` forge call was dropped in favour of a git-level trigger in the landing path; the
only new forge method is the read-only `hasUsableCheckRun`.

### 3. Runner awareness from the runners API plus the workflow files

`GhForge.runnerStatus(cwd)` reads `GET repos/{owner}/{repo}/actions/runners` and returns
`{ onlineLabels }` (or `null` when it cannot answer). A pure `requestedRunnerLabels(clonePath)` reads
`.github/workflows/*.yml` for `runs-on` values, skipping GitHub-hosted images and `${{ … }}`
expressions. A pure `runnerGaps(requested, online)` names the self-hosted labels no online runner
serves. The alarm appends "no online runner for `<label>`" when any gap exists. A forge or clone that
cannot answer produces no such claim.

### 4. The four failure-only landings are proven against the new gate

VS-466's audit recorded four heads whose only `pull_request` run failed: PR #283 (VS-340,
`c18a7e70e387`), PR #300 (VS-363, `ac57b77e86ff`), PR #302 (VS-358, `d2f3ae5cc1d9`) and PR #282
(`af0980c68825`). Their recorded `statusCheckRollup` (captured with `gh pr view --json
statusCheckRollup`) is replayed: each contains a `FAILURE` check, so `rollupState` is `failure` and the
gate returns `checks_failed`, never a merge. They are committed as fixtures.

## Non-goals

- Changing the success rule (VS-466).
- Batching landings (pending captain's decision after VS-464).
- Speeding CI up or provisioning the self-hosted runner (VS-394/395).
