## Context

`mergeDone` (`packages/core/src/tickets/service.ts:1699`) only attempts to land a ticket's delivery
inside `if (t.projectId) { ... }`. When `t.projectId` is null the whole block — including the
`log.warn('mergeDone: no project clone available; skipping delivery landing')` line — is skipped
entirely, and control falls through to the terminal step (~line 1870) that always writes
`delivery.merged: true` and `status: 'done'`, using `info.mergeCommit` (the caller's own claim) if no
`trustedMerge` was established. That is exactly VS-665's shape: no project, a pull-request work
product still pointing at an open draft PR, and a caller that (per the incident) supplied no
mergeCommit at all — so the record reads `merged: true, mergeCommit: null`.

## Decision 1 — scope the fix to "no project, but something to land"

The existing test suite (`tickets.test.ts`'s whole `mergeDone` describe block, `merge-queue.test.ts`,
etc.) exercises `mergeDone(AGENT, t.id, { mergeCommit: 'abc1234' })` on tickets whose `projectId` *is*
set but whose `deps().projects` service the test never stubbed — `project = null` after the
try/catch, hitting the very same `else` branch this change touches, and every one of those tests
expects the call to still complete. That is a deliberate, long-standing tolerance for "the project
lookup itself failed" (project deleted, clone wiped, or a test harness that does not care) — VS-250
already chose to surface that as `incompleteDelivery()` rather than fail the call, and widening the
throw to that whole branch would be a much bigger behavioural change than this ticket asks for, and
would break dozens of unrelated tests that are not testing this bug.

The incident's actual condition is narrower and cleanly distinguishable: `t.projectId` is `NULL`, so
the code never even attempts a project lookup. That path never had a warning, let alone a check
against whether there is a real pull request to land. This change closes exactly that gap: when
`t.projectId` is null, look for a `pull_request` work product on the ticket; if one exists, throw
(`merge_unverified`, retryable — same code the other landing-failure branches in this function already
use) instead of falling through. A projectless ticket with no PR (a genuine "nothing to land" ending)
keeps completing exactly as before — that is the `schedules nothing for a ticket without a project`
scenario `tickets.test.ts` already covers, and it stays green.

Considered and rejected: throwing whenever `project` resolves to `null` for *any* reason (including
project/clone missing when `t.projectId` is set). Rejected because it conflates two different
failures — a ticket that legitimately never had a project, versus a project that transiently can't be
resolved for one that does — and the latter's current behavior is deliberately tolerated elsewhere
(`incompleteDelivery()`). Revisiting that tolerance is a separate, larger decision than this incident
calls for.

## Decision 2 — self-heal via reconcile, not a one-off DB edit

`mergeDone` cannot be called again for VS-665 (it is `done`, not `merging`, and `wrong_status` refuses
a re-entry). Directly editing its `delivery` JSON from outside the ticket service would bypass every
invariant `mergeDone` itself enforces (forge-confirmed SHA, `ticket.merged` event, work-product
bookkeeping) and would need touching the live daemon's database from a worker — explicitly out of
bounds.

Instead, `reconcilePass`'s existing periodic sweep (`packages/core/src/supervisor/index.ts`, next to
`reconcilePullRequests`) gets a new step: for a `done` ticket whose delivery matches
`incompleteDelivery()`'s signature and still names a pull-request URL, ask the forge for that pull
request's current state. If the forge reports it merged, write the real `mergeCommit`/`merged`/
`method` onto the ticket's delivery — the same fields `mergeDone` itself would have written — and
nothing else (no status change, no new work product, no re-triggering follow-up work: the ticket
already finished once). If the forge still shows it open, draft or closed-unmerged, nothing changes;
the ticket stays visibly incomplete. This is the mechanism that corrects VS-665 once PR #534 is
actually merged (operationally, as part of this same ticket), and it runs for every other ticket the
same projectId-null window could have affected — no bespoke script, no manual edit.

## Non-goals

- Not attempting to re-run `openspec archive` or any other post-merge follow-up for a ticket the
  reconcile step corrects — those follow-ups matter for a live landing, not for fixing a stale record
  on a ticket that is otherwise finished.
- Not widening `mergeDone`'s failure to the "project set but unresolved" branch (Decision 1).
