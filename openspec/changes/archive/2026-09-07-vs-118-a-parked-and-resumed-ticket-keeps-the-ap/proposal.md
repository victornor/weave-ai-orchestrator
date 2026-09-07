## Why

A worker that gets parked (its automatic retries spent, or a non-retryable failure) has its ticket
moved to `blocked` by `parkForHuman` (`packages/core/src/runs/engine.ts`). When a human resumes that
worker, three call sites decide what status to put the ticket back into — `workers.resume`
(`packages/core/src/workers/index.ts`), `tickets.retry` (`packages/core/src/tickets/service.ts`) and
the "retry now" answer to the parking decision (`packages/core/src/decisions/service.ts`) — and all
three use the same test: `ticket.executionRunId ? 'in_progress' : 'todo'`.

That test is always false. `execution_run_id` is a per-run execution lock, set when a run claims the
ticket and unconditionally cleared by `finalize()` for every run outcome, success or failure, before
`parkForHuman` ever runs (`engine.ts`, the `UPDATE tickets SET execution_run_id = NULL ...` a few
lines above the `parkForHuman` call). By the time any of the three call sites read
`ticket.executionRunId`, it has already been nulled by the very run that got parked. So resuming a
parked ticket always sends it to `todo`, regardless of what it actually was — `approved`,
`in_progress`, `in_review`, even `merging`.

For a `task` ticket this is a harmless extra hop (`todo -> in_progress`, no approval gate between
them). For a `change` ticket it is not: `todo` only reaches `approved` again by walking the whole
`proposing -> proposed -> approved` path, which raises a **second plan-approval decision for a plan
that has not changed**. That happened twice on VS-110, at 19:05 and 19:51, for the same approved,
unchanged artifacts, after a crash during delivery (`git push`, exit 143) parked the worker with 17 of
18 apply tasks already implemented and committed.

`paused-worker-visibility` already requires that "resuming shall not reset the ticket's progress" and
that the ticket "returns to the status the work continues in" — the implementation just has no way to
know what that status was, because the one signal it reads was already erased.

## What Changes

**Record the status a ticket was in when it became `blocked`, on the ticket itself, and read that
back instead of the always-null execution lock.**

- `tickets.transition` already carries a matching pattern for a `blocked` transition:
  `unblockJson`/`blockedTransitionAt` are set when entering `blocked` and cleared on every other
  transition (`packages/core/src/tickets/service.ts`). A new field, `blockedFromStatus`, follows the
  same rule: set to the ticket's current status the moment it transitions **to** `blocked` (whatever
  that status was — `approved`, `in_progress`, `in_review`, `merging`, `todo`, `proposing`), cleared
  to `null` on every transition away from `blocked`. This is the one place a ticket's status changes,
  so it is the one place that can durably capture what it was about to lose.
- The three call sites that decide what a resumed/retried ticket returns to —
  `workers.resume`, `tickets.retry`, and `decisions.applyRetryApproval` — stop reading
  `ticket.executionRunId` (always null by the time they run) and instead restore
  `ticket.blockedFromStatus`, falling back to `todo` only when it is absent (a ticket blocked before
  this change shipped, or blocked by some path that does not go through `transition()`).
- The same stale test exists in one more place doing the same job for a different reason:
  `tickets.propagateTerminal` decides what a dependent ticket returns to when its blocking ticket
  finishes, using `dep.assigneeRoleId || dep.workerId ? 'todo' : 'backlog'` — a heuristic that also
  cannot tell `approved`/`in_progress` from `todo`. It reads the same new field the same way, with the
  same `todo`/`backlog` fallback it already has today for tickets that have no recorded
  `blockedFromStatus`. This is the same defect, found in the one other place it lives, fixed by the
  one field that already answers it — not a new scope, a second consumer of the same fix.
- No change to the transition state machine (`packages/shared/src/transitions.ts`): `blocked` already
  allows returning to every status a ticket could have been blocked from, for every ticket kind.
  Nothing here special-cases a status in the table; it fixes what the resume/retry code reads to pick
  one.
- Out of scope, per the ticket: VS-115 (the upgrade drain that caused the parks) and VS-104 (repairing
  a *missing* approval) — this only stops a *present* approval from being re-asked for.

## Impact

- `packages/db/src/migrations/0016_ticket_blocked_from_status.sql` (new) — `ALTER TABLE tickets ADD
  COLUMN blocked_from_status TEXT`.
- `packages/shared/src/types.ts` — add `blockedFromStatus: E.TicketStatus | null` to `Ticket`.
- `packages/core/src/tickets/service.ts` — set/clear `blockedFromStatus` in `transition()`; read it in
  `retry()` and `propagateTerminal()`.
- `packages/core/src/workers/index.ts` — read it in `resume()`.
- `packages/core/src/decisions/service.ts` — read it in `applyRetryApproval()`.
- `openspec/specs/run-recovery/paused-worker-visibility/spec.md` — tighten "Resume unblocks the
  ticket" to say explicitly that the ticket returns to the exact status it held immediately before it
  was blocked, not a status inferred from anything else, and add the `change`-ticket case (no
  re-approval) as its own scenario.
- No API or CLI surface change: `Ticket.blockedFromStatus` is additive and nothing outside `core`
  reads or sets it directly.
