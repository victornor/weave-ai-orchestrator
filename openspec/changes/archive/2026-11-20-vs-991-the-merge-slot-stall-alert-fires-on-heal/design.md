## Where it lives today

- Threshold: `mergeChecksAlarmSec` (`packages/shared/src/config.ts`, default 1200, min 60), configurable per daemon.
- Alarm: `wakeMergingOnProgress` → `raiseMergeChecksAlarm` in `supervisor/index.ts`. It posts a `status`
  comment and enqueues a `system` wake (`kind: merge_stalled`) for the weaver. It never transitions the ticket.
- The `blocked` transition came from the response to the alert (`tickets/service.ts` `transition`: leaving
  `merging` calls `mergeQueue.leave`, nulling `merge_queued_at`/`merge_started_at`).

## Decision

Option 2 (judge per check), using GitHub's own limits, over a derived deadline or a per-project timeout:
- Observed-duration derivation needs run history `gh pr view` does not give and is wrong on the first slow run of a growing suite.
- A per-project timeout is the same guess as today with a knob.
- Per check, from data already in the rollup (`status`, `startedAt`): running < 360 min is slow, not hung.

`judgeMergeChecks` (pure) returns `stuck: false` or `stuck: true` with a kind (`not_started`,
`past_job_timeout`, `no_run`). `no_run` (nothing pending by name) falls back to the slot's age against
`mergeChecksAlarmSec`, which is the old behaviour for "no run / all skipped".

## Not changed

`mergeQueue.leave` semantics: a ticket that is deliberately moved out of `merging` still loses its place.
The fix is that the alert neither does that nor invites it. If the weaver wants block-without-losing-place
that is a separate change.
