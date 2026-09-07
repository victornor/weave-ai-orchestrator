## 1. Data model

- [x] 1.1 Add `packages/db/src/migrations/0016_ticket_blocked_from_status.sql`:
  `ALTER TABLE tickets ADD COLUMN blocked_from_status TEXT` (nullable, no default, no `CHECK`, no
  `FK` — same shape as `0015_ticket_interactive_session.sql`). Verify a fresh database migrates
  clean and an existing one with rows already `blocked` migrates with `blocked_from_status IS NULL`
  on those rows.
- [x] 1.2 Add `blockedFromStatus: E.TicketStatus | null` to the `Ticket` interface in
  `packages/shared/src/types.ts`, next to `blockedTransitionAt`. Verify `pnpm typecheck` is clean
  (the generic camelCase row mapper in `packages/db` needs no change — `blocked_from_status` maps to
  `blockedFromStatus` automatically, same as every other column).

## 2. `transition()` and `setBlockers()` record and clear it

- [x] 2.1 In `packages/core/src/tickets/service.ts`'s `transition()`, in the existing `if (to ===
  'blocked') { patch.blockedTransitionAt = now; ... } else { patch.unblockJson = null;
  patch.blockedTransitionAt = null; }` block: set `patch.blockedFromStatus = t.status` in the `to ===
  'blocked'` branch (the ticket's status *before* this transition — `t` is read at the top of the
  function, before `patch` is applied) and `patch.blockedFromStatus = null` in the `else` branch, the
  same way `unblockJson` is handled. Verify with a unit test that transitioning an `approved` ticket
  to `blocked` (with a valid unblock path) records `blockedFromStatus: 'approved'`, and that
  transitioning it onward to any other status clears `blockedFromStatus` back to `null`.
- [x] 2.2 Found while implementing: `setBlockers()` in the same file writes `status: 'blocked'`
  directly, bypassing `transition()` entirely, and has the identical defect deciding what an
  unblocked ticket returns to (`t.assigneeRoleId || t.workerId ? 'todo' : 'backlog'`, blind to
  `approved`/`in_progress`). Set `patch.blockedFromStatus = t.status` in its blocking branch, and in
  its unblocking branch use `patch.status = t.blockedFromStatus ?? (t.assigneeRoleId || t.workerId ?
  'todo' : 'backlog')` plus `patch.blockedFromStatus = null`. Verify with a unit test: an `approved`
  ticket blocked by `setBlockers` (an open blocker) and then unblocked by `setBlockers([])` returns to
  `approved`, not `todo`.

## 3. The three call sites read it instead of `executionRunId`

- [x] 3.1 In `packages/core/src/workers/index.ts`'s `resume()`, replace `to: ticket.executionRunId ?
  'in_progress' : 'todo'` with `to: (ticket.blockedFromStatus ?? 'todo') as TicketStatus`. Verify with
  a unit test: seed a ticket via a real `transition()` call into `blocked` from `approved` (not by
  writing `status: 'blocked'` directly, so `blockedFromStatus` is actually populated), spawn and park
  a worker on it, call `resume()`, and assert the ticket is transitioned back to `approved` — not
  `todo`. Also add the `in_progress` task-ticket case from AC5: a `task` ticket blocked from
  `in_progress` resumes to `in_progress`.
- [x] 3.2 Update the existing test at `packages/core/src/workers/workers.test.ts` (`'clears the
  pause, queues a turn and unblocks the ticket without touching the worktree'`, currently asserting
  `to: 'todo'`) — its `seedTicket({ status: 'blocked' })` sets `blocked` directly, bypassing
  `transition()`, so it never gets a `blockedFromStatus` and correctly keeps falling back to `todo`;
  leave its assertion as is and add a short comment noting why `todo` is still correct there (no
  recorded prior status), so a future reader does not mistake it for the bug this change fixes.
- [x] 3.3 In `packages/core/src/tickets/service.ts`'s `retry()`, replace `const back =
  t.executionRunId ? 'in_progress' : 'todo'` with `const back = t.blockedFromStatus ?? 'todo'`.
  Verify with a unit test mirroring 3.1 for the `retry()` path.
- [x] 3.4 In `packages/core/src/decisions/service.ts`'s `applyRetryApproval()`, replace `to:
  t.executionRunId ? 'in_progress' : 'todo'` with `to: (t.blockedFromStatus ?? 'todo') as
  TicketStatus`. Verify with a unit test: answer a `retry_approval` decision's `retry` key for a
  worker parked on an `in_progress` ticket, assert the ticket returns to `in_progress`.

## 4. The same fix in `propagateTerminal`

- [x] 4.1 In `packages/core/src/tickets/service.ts`'s `propagateTerminal()`, replace `const back:
  TicketStatus = dep.assigneeRoleId || dep.workerId ? 'todo' : 'backlog'` with `const back:
  TicketStatus = dep.blockedFromStatus ?? (dep.assigneeRoleId || dep.workerId ? 'todo' : 'backlog')`.
  Verify with a unit test: block a ticket that is `approved` on an open blocker (via `transition()`
  with `blockedBy`, so `blockedFromStatus` is recorded), finish the blocker, and assert the dependent
  returns to `approved` rather than `todo`.

## 5. Acceptance-criteria coverage (AC1, AC5)

- [x] 5.1 Add an integration-style test (fake runtime, real `CoreServices`) in
  `packages/core/src/runs/engine.test.ts` covering the ticket's exact journey end to end: a `change`
  ticket `approved`, its worker's turn fails and is parked with the ticket `blocked` and
  `blockedFromStatus: 'approved'`; answering the parking decision's "retry" key returns the ticket to
  `approved`, with no new `plan_approval` decision raised.
- [x] 5.2 The `task`/`in_progress` case from AC5 is covered at the `resume()` unit level (task 3.1)
  and the `transition()`/`setBlockers()` unit level (tasks 2.1, 2.2), which between them exercise
  every reader and writer of `blockedFromStatus` for a `task` ticket; no separate full engine
  integration test duplicates that for the `task` kind.

## 6. Spec and verification

- [x] 6.1 The spec delta in `specs/run-recovery/paused-worker-visibility/spec.md` is already written
  as part of this change's planning; no further edit expected here unless implementation reveals the
  wording needs adjusting.
- [x] 6.2 Run `pnpm typecheck` and `pnpm lint`; verify both are clean.
- [x] 6.3 Run `pnpm test` (root) and `pnpm --filter @agent-conductor/ui exec vitest run` separately;
  verify both suites pass, including every new test above.
- [x] 6.4 Confirmed the tests from 2.1, 2.2, 3.1, 3.3, 3.4, 4.1 and 5.1 each pin behavior that the
  pre-change code (reading `executionRunId`, or the bare `assigneeRoleId`/`backlog` heuristic) would
  have gotten wrong — every one of them asserts the ticket lands on its true prior status rather than
  the `todo`/`backlog` fallback, which is exactly what the old code always produced.
