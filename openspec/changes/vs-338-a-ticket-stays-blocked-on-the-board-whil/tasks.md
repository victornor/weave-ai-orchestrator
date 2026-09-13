## 1. `resumeIfBlocked` and a quiet restore on the tickets service

- [x] 1.1 Add `resumeIfBlocked(actor: Actor, id: string, reason: string): Promise<S.Ticket>` to the
  `TicketsService` interface in `packages/core/src/api.ts`, documented as "a resolving wake starting
  a worker's turn returns a blocked ticket to the status it held before the block, unless it is
  still waiting on an unfinished blocker".
- [x] 1.2 Implement it in `packages/core/src/tickets/service.ts`. When the ticket is not `blocked`,
  return it unchanged. When any ticket in `blockersOf(t.id)` is not `done`, return it unchanged.
  Otherwise transition through the inner `transition()` to
  `t.blockedFromStatus ?? (t.assigneeRoleId || t.workerId ? 'todo' : 'backlog')` with the given note
  and a quiet flag. Guard the transition and log at warn on failure, returning the unchanged ticket —
  a refused restore must never break the worker's turn.
- [x] 1.3 Give the inner `transition()` a third, internal `opts: { quiet?: true }` parameter (the
  public `TicketsService.transition` keeps its two-argument signature). Under `quiet`, suppress the
  `in_review` `merge_approval` create/supersede and the `approved` `ticket_assigned` wake; leave the
  `autoMergeSweep` scheduling and the merge-queue join untouched.
- [x] 1.4 Verify with unit tests in `packages/core/src/tickets/tickets.test.ts`: a ticket
  transitioned to `blocked` from `in_progress` with `{owner, action}` is restored to `in_progress`
  by `resumeIfBlocked`, with the status event/activity recorded; a ticket blocked by an unfinished
  `blockedBy` ticket is left `blocked`; a ticket whose `blockedBy` ticket is already `done` is
  restored; an `approved` ticket restored quietly raises no `ticket_assigned` wake; an `in_review`
  ticket restored quietly neither supersedes nor re-raises an open `merge_approval` (and preserves
  its `weaver_review_status`).

## 2. The resolving-wake predicate and the call in the engine

- [x] 2.1 In `packages/core/src/runs/engine.ts`, add a small predicate over the run's claimed wakes,
  flattening them first (import `flattenWakes` from `../prompts/index.js`) so a coalesced bundle
  counts. A wake resolves the block when its source is `decision_answered` (with a payload
  `ticketId` that is absent or equal to this ticket), `conductor_request`, `human_message` or
  `live_interrupt`; when it is a `ticket_comment` requested by a human; when it is `retry` requested
  by a human; or when it is a `system` wake marked `resumed` or carrying a `relaunchNote`.
  Everything else (`self_scheduled`, `routine`, `ticket_assigned`, a generic `system` wake, a
  system-booked `retry`) is not resolving.
- [x] 2.2 In `executeRun`, after the model setting resolves and the curation freshness gate has
  passed, and immediately before the run is marked `running`, call
  `deps().tickets.resumeIfBlocked({ kind: 'system', id: null }, ticket.id, "<agent name> resumed
  after the block was answered")` when `ticket.status === 'blocked'` and the predicate is true.
  Await it. Never call it when the ticket is not blocked or no claimed wake resolves the block.
- [x] 2.3 Verify with an engine test that a `blocked` ticket's restore happens before the turn does
  any work, and that a curation ticket whose freshness gate blocks it stays `blocked` (the call sits
  after that gate).

## 3. Tests for the chosen trigger

- [x] 3.1 `packages/core/src/runs/engine.test.ts`: seed a `task` ticket `in_progress`, transition it
  to `blocked` with `{owner: 'weaver', action: ...}` through the real `tickets.transition`, enqueue a
  resolving wake (`decision_answered` or `conductor_request`) for the worker, run the turn, and
  assert the ticket is `in_progress` again, restored before the turn, with the note recorded.
- [x] 3.2 Add the repeating-wake case the weaver asked for: a `blocked` ticket whose worker's turn
  starts from a `self_scheduled` wake (and, separately, a generic `system` wake and a
  system-requested `retry`) stays `blocked`, and no `ticket_blocked` wake is sent to the weaver.
- [x] 3.3 Add the still-open-blocker case: a ticket blocked with an unfinished `blockedBy` ticket
  whose worker's turn starts from a resolving wake stays `blocked`.
- [x] 3.4 Add the re-block case: after a resolved block is undone, the worker's turn moves the
  ticket back to `blocked`; assert it remains `blocked` afterwards and that no further run is
  enqueued without a new wake.
- [x] 3.5 Add the no-side-effects case: restoring a ticket from `blocked` to `in_review` leaves an
  open merge-approval card (and its weaver review mark) intact and raises no replacement; restoring
  to `approved` queues no `ticket_assigned` wake for the worker.
- [x] 3.6 Confirm the restore/block tests fail against the pre-change code (no `resumeIfBlocked` call
  in the engine), and that the non-resolving-wake and no-side-effects tests would fail against the
  rev-1 design (any-turn-start / non-quiet).

## 4. Correct both skill instructions

- [x] 4.1 In `skills/weave-ai-worker/SKILL.md`, rewrite the `blocked` row of the status table so it
  says: the daemon returns the ticket to the status it was blocked from when a resolving wake starts
  your turn, so do not move it yourself; re-block with a routable path (`blockedBy` or
  `{owner, action}`) only if you are still stuck. Keep it one row. It must not tell the worker to
  transition the ticket back first.
- [x] 4.2 In `skills/weave-ai-weaver/SKILL.md`'s unblock ladder, state that resolving a block by
  answer (`weave_decision_answer`) or steering (`weave_worker_message`) wakes the worker, and the
  ticket's status is restored when that worker's turn starts; the weaver never transitions the
  ticket itself. One or two sentences.

## 5. Spec and verification

- [x] 5.1 The new capability delta in
  `specs/ticket-lifecycle/blocked-resume/spec.md` is written as part of this change's planning;
  adjust the wording only if implementation shows it wrong.
- [x] 5.2 Run `openspec validate vs-338-a-ticket-stays-blocked-on-the-board-whil --json --strict`
  and verify it is clean.
- [x] 5.3 Run `pnpm lint` and `pnpm typecheck`; verify both are clean.
- [x] 5.4 Run `pnpm test` (core/server suite) and
  `pnpm --filter @weave-ai/ui exec vitest run` separately; paste both suite blocks verbatim in the
  report and verify both pass, including every new test above.
- [x] 5.5 Confirm no database migration, HTTP route or MCP tool was added: this is daemon-internal
  behavior plus two skill edits.
