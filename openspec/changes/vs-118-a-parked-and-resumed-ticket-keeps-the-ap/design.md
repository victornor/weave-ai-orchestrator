## Context

See `proposal.md` - Why. This section only adds what is needed to justify the design, not the
motivation.

**What actually reverts the status (AC3).** Neither the park path nor the crash handler resets the
ticket's status. Three separate places do, all reachable only from the resume/retry side, all reading
the same wrong signal:

- `packages/core/src/workers/index.ts`, `resume()` — reached when a human clicks resume, or when
  `relaunch()` sees a `paused` agent with a `pauseDetail` and delegates to `resume()`.
- `packages/core/src/tickets/service.ts`, `retry()` — the ticket-level manual retry action.
- `packages/core/src/decisions/service.ts`, `applyRetryApproval()` — the "retry now" answer to the
  parking decision itself.

All three compute `ticket.executionRunId ? 'in_progress' : 'todo'`. `execution_run_id` is a per-run
execution lock: `packages/core/src/runs/engine.ts`'s `finalize()` clears it unconditionally
(`UPDATE tickets SET execution_run_id = NULL ... WHERE execution_run_id = ?`) for every run outcome —
success, failure, or the interrupted run that is about to be parked — several lines *before*
`parkForHuman` is even called for a failure. So by construction, by the time any resume/retry path
runs, `ticket.executionRunId` has already been nulled by the very run that triggered the park. The
ternary is dead code: it is always `todo`.

Nothing re-derives status from OpenSpec state either (`openspec/index.ts` only stores an OpenSpec
state snapshot on the ticket; it never drives a status transition). The park path itself
(`parkForHuman`) only ever writes `to: 'blocked'` — it does not choose or record what the ticket was
before.

The crash handler (`finalize()`'s `exit_143`/`SIGTERM` classification, `errorFamily: 'tooling'`) does
not touch ticket status at all: `'tooling'` is not retryable and does not reach `parkForHuman` on its
own (only a `failed` status does); a later failed retry's own `parkForHuman` call is what eventually
blocks the ticket, through the same unconditional `execution_run_id` clear.

**A fourth site with the identical defect, found while implementing.** `tickets.setBlockers()`
(`packages/core/src/tickets/service.ts`) writes `status: 'blocked'` directly — it does not call
`transition()` at all — and, symmetrically, decides what an unblocked ticket returns to with `t
.assigneeRoleId || t.workerId ? 'todo' : 'backlog'`, the exact same heuristic `propagateTerminal` had.
This is not a resume/retry path (it fires when a ticket's own `blockedBy` list is set or cleared, and
when the last open blocker's own status changes are noticed independently of `propagateTerminal`), but
it is the same defect for the same reason: a direct writer of `blocked` that never recorded what
preceded it. It gets the same fix.

## Goals / Non-Goals

**Goals:**
- Give the three resume/retry call sites a durable, correct signal for "what status was this ticket
  in before it was blocked" that does not depend on a lock that is guaranteed to be gone.
- Fix the one place a ticket's status changes (`tickets.transition`) rather than adding a fourth
  ad hoc recovery in a fourth call site.

**Non-Goals:**
- Changing when or why a ticket is parked, or the retry ladder / backoff (VS-115's concern).
- Repairing a ticket that is missing an approval it should have (VS-104's concern) — this only stops
  an approval that already happened from being asked for twice.
- Changing the transition state machine itself (`packages/shared/src/transitions.ts`): `blocked`
  already permits returning to every status a ticket could plausibly have been blocked from, for
  every kind.

## Decisions

**Store the pre-blocked status on the ticket row, set only by `transition()`, not derived by each
reader.** Alternatives considered:

1. *Read the ticket's own transition history* (the `activity` table already records `{from, to}` on
   every `ticket.transition` event) and look up the most recent `to: 'blocked'` entry's `from`. Works,
   but couples three call sites to the shape of an audit-log JSON payload that was never meant to be
   queried as a source of truth, and requires a `WHERE json_extract(...)` query (or a full table scan
   filtered in code) at every resume — for a fact the transition function already knows for free at
   the moment it happens.
2. *Add a durable column, `blocked_from_status`, written by `transition()` itself.* Chosen. This is
   the exact pattern the ticket row already uses for the sibling fact `unblockJson`/
   `blockedTransitionAt` (`packages/core/src/tickets/service.ts`, the same `if (to === 'blocked') ...
   else { patch.unblockJson = null; ... }` block) — one more field set in the same branch, cleared in
   the same `else`. No new query shape, no coupling to log payloads, and it is trivially correct: it
   is only ever read immediately after being written by the same code path that maintains it.

**Reuse the same field for `propagateTerminal`'s dependency-unblock path.** That function has the
identical defect for a different trigger (a *different* ticket finishing, not a resume): it decides a
dependent's post-`blocked` status with `dep.assigneeRoleId || dep.workerId ? 'todo' : 'backlog'`,
which cannot tell `approved`/`in_progress` from `todo` either. Since the new field is set on *every*
`blocked` transition regardless of why, this path gets the same correctness for the same reason, by
reading the same field — not a new mechanism, the same one applied where the same defect already
lived. The existing `assigneeRoleId`/`backlog` heuristic remains as the fallback for tickets blocked
before this field existed, exactly as `todo` remains the fallback for the resume paths.

**Fall back to `todo` (or, for `propagateTerminal`, the existing heuristic) when the field is absent.**
A ticket already `blocked` on the day this ships has no recorded `blockedFromStatus`; there is no way
to recover what it was without it, and `todo` (never losing anything the ticket itself remembers — it
is still on its branch, still has its OpenSpec artifacts) is the same safe default the code already
falls back to today.

## Risks / Trade-offs

- **Migration adds a nullable column with no backfill.** Tickets already `blocked` when this ships
  keep resuming to `todo` exactly as before — no regression, just no improvement for that one ticket.
  Every ticket blocked after the migration is correct. → Accepted; a backfill has nothing to backfill
  from (the information was never recorded).
- **A ticket manually forced to `blocked` outside `transition()`** (there is no such path in this
  codebase today — every write to `tickets.status` goes through `transition()` or the handful of
  terminal-state helpers that do not target `blocked`) would have no `blockedFromStatus` and would
  fall back to `todo`. → No code path exists that does this; noted for future reviewers of this field.
- **Restoring a status whose entry guard depended on a fact that is no longer true** (e.g. restoring
  to `in_review`, which `checkTransition` requires a recorded work product for) — not a new risk: the
  ticket already had a work product when it first reached `in_review`, and nothing about being parked
  removes it, so the guard still passes. Same reasoning covers `merging`'s `mergeApproved` guard.

## Migration Plan

Additive, single-column migration (`ALTER TABLE tickets ADD COLUMN blocked_from_status TEXT`, no
`CHECK`, no `FK`, no default needed beyond SQLite's implicit `NULL`), the same shape as the most
recent precedent (`0015_ticket_interactive_session.sql`). No rollback step beyond a reverse migration
if one is ever wanted — nothing else depends on the column existing, and its absence is already a
handled case (falls back to `todo`/the existing heuristic).
