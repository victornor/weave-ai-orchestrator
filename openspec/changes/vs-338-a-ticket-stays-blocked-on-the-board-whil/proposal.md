## Why

A ticket moved to `blocked` with an `{owner, action}` path — a worker stuck on a decision, a
weaver answer, or a human reply — has no automatic exit from `blocked` once that path is resolved.
Answering the decision, sending a weaver message, or leaving a human comment all wake the worker,
but none of them touch the ticket status, and the only instruction to undo the block is one table
row in the worker skill that workers miss. In fern-ofm, VOFM-55 stayed `blocked` on the board for over
1.5 hours while its worker had the blocker answered, raised three action cards, ran a production
deploy and was still working: the board said blocked while the Live page said working.

The three existing automatic exits only cover a ticket blocked by other tickets (`blockedBy`
tickets finishing), a quota-paused worker being resumed, and a human retry. A block resolved by an
answer, a message or a comment leaves the ticket behind, so the board, the digest and every surface
reading status lie about work that is happening.

## What Changes

- **The daemon reopens a blocked ticket when a resolving wake starts its worker's turn.** A wake
  that puts the worker back on the ticket on purpose — a decision answered on that ticket, a weaver
  message (`conductor_request`), a human message or comment, a live interrupt, a resume, or a
  human-requested retry/relaunch — reopens a `blocked` ticket before the turn does any work. A
  generic `system` digest, a `self_scheduled` self-check, a `routine` fire or a system-booked
  `retry` does not: a blocked ticket must not churn its status, or wake its owner again, because a
  timer fired.
- **The ticket returns to the status it held immediately before the block** (`blockedFromStatus`,
  with the fallback `retry()`/`propagateTerminal()` already use), through `tickets.transition`, so
  the status event, activity log, board and weaver all see it, and its note says why.
- **A ticket still waiting on unfinished `blockedBy` tickets is never reopened by this.** The
  existing blocker guard is checked first; only a block with no outstanding blocker is resolved.
- **The restore is quiet.** It must not disturb work the block was merely sitting in front of:
  restoring to `in_review` does not supersede or re-raise the open merge card (which would drop a
  weaver's review mark minutes before the human taps it), and restoring to `approved` does not
  enqueue the `ticket_assigned` wake that first entering `approved` sends — the worker is already
  starting this turn, and a second wake would queue a second one.
- **Re-blocking keeps working and does not churn.** A worker that is still stuck moves its ticket
  back to `blocked` in its turn as it always has; nothing restores it again until another resolving
  wake starts another turn.
- **Both skill instructions are corrected.** The worker skill's `blocked` row says the daemon
  returns the ticket when a resolving wake starts the turn, and that the worker re-blocks with a
  routable path only if it is still stuck; the weaver skill's unblock ladder says the status is
  restored when the worker's turn starts, and that the weaver never transitions the ticket itself.
- It works for every ticket kind, using the kind's own `blocked →` targets; no change to the
  transition state machine is needed because `blocked` already reaches every status a ticket can be
  blocked from.

## Capabilities

### New Capabilities

- `ticket-lifecycle/blocked-resume`: a blocked ticket returns to the status it held before the
  block when a resolving wake starts its worker's turn, unless it is still waiting on unfinished
  `blockedBy` tickets; the restore is quiet and a non-resolving wake does not reopen it.

### Modified Capabilities

_None. The existing blocked/park and resume requirements keep their behavior; this adds the missing
exit for a block resolved by a wake rather than a status change._

## Impact

- `packages/core/src/tickets/service.ts` — a new `TicketsService.resumeIfBlocked` that guards on
  unfinished blockers, reads `blockedFromStatus` (falling back the same way `retry()` and
  `propagateTerminal()` already do) and transitions through the normal path; the inner `transition`
  gains an internal quiet option that suppresses the `in_review` merge-card raise and the `approved`
  wake.
- `packages/core/src/api.ts` — the method on the `TicketsService` interface.
- `packages/core/src/runs/engine.ts` — the resolving-wake predicate over the run's claimed wakes
  (including coalesced bundles), and the one call per turn after the model resolves and the
  pre-turn curation gate has run, before the turn launches.
- `skills/weave-ai-worker/SKILL.md` and `skills/weave-ai-weaver/SKILL.md` — the two instruction
  edits.
- `openspec/specs/ticket-lifecycle/blocked-resume/` — the new capability (created on archive).
- No HTTP, MCP or CLI surface change, and no database migration: `blockedFromStatus` already exists.
