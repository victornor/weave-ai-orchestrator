## Why

`autoMergeSweep()` (`packages/core/src/tickets/service.ts`) runs on every supervisor tick for each
`in_review` ticket with `autoMerge` or YOLO. Every pass that cannot advance posted an identical
`auto-merge is waiting: …` system comment: `'the weaver has concerns'` when the merge approval threw
`revision_pending`, `'CI is red on the PR'` when the check rollup failed. Measured in
`ticket_comments` after YOLO was enabled for this project (2026-09-15 02:58:58Z), VS-457 and VS-467
each held 18 identical comments between 02:59:08Z and 03:02:53Z — one per 15-second pass, roughly
5,800 a day for one held ticket. It floods the ticket thread, the events table and every UI watching
the ticket, and buries the worker's own comments.

## What Changes

- The sweep records the reason **and** the pull request head it is waiting on in the ticket's
  `delivery` JSON and posts a waiting comment only when that pair is new. An unchanged hold on the
  next pass is a debug log line, not a comment.
- A new pull request head counts as new: a push that is still held produces exactly one more comment.
- A switch of reason (concerns → CI red, or back) produces one more comment.
- An advance drops the recorded hold, so a ticket that returns to `in_review` and is held again for
  the same reason comments afresh.
- The state lives in the database, so a daemon restart does not re-post an unchanged hold.
- Everything else is unchanged: the sweep still re-checks on every pass and advances as soon as it
  can; the `revision_pending` hold and the CI-red wait behave as before.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — a task ticket's tracker change; `skip_specs: true`)

## Impact

- `packages/core/src/tickets/service.ts` — `autoMergeSweep` and two new helpers
  (`recordAutoMergeHold`, `clearAutoMergeHold`).
- `packages/core/src/tickets/auto-merge-hold.test.ts` — the new tests.
- No schema, route, config or UI-contract change. The hold is an extra key on the existing
  `tickets.delivery_json` blob; existing delivery readers ignore unknown keys.
- The only other every-pass comment site in this file, `recordArchiveLandingFailure` (VS-389), already
  dedupes per `(reason, pull request)`, so it is left alone.