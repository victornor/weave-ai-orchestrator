## Context

See proposal.md - Why. `stalledWorkers()` (`packages/core/src/supervisor/index.ts:641-667`) is a
single SQL query joined against `tickets`; its only agent-status exclusion today is
`a.status != 'retired'`. `weave_worker_cancel`'s handler (same file, `cancel()` at line 837) sets
`status: 'done'` and deliberately does not archive the worktree (PLAN §11.5) or transition the
ticket, matching the same `status: 'done'`-stays-`done` pattern `retireIfLanded`'s `refuse()` path
already uses for a normally-finished worker whose work has not landed (VS-333 comment at line 933).

## Goals / Non-Goals

**Goals:**
- Stop the stall watchdog from ever flagging, recovering, or escalating a worker whose own
  `status` is `done`, regardless of its ticket's status.

**Non-Goals:**
- Changing `weave_worker_cancel`'s terminal state, or making cancel reach `retired`/set
  `retiredAt`. `done` is the correct, intentional state for both a cancelled worker and an
  unlanded-but-finished one; neither should be swept into archival by this change.
- Changing `retireFinished` / the retirement sweep's own criteria.

## Decisions

- **Fix the watchdog's exclusion, not the cancel handler.** `done` is already a standing
  terminal-ish agent state by design (VS-333): a worker there is not mid-turn and has no route to
  regain one except a human action (relaunch, resume, or a ticket transition), none of which this
  detection is meant to nudge along. The query's own intent — "no possible source of a future
  wake" — already describes a `done` worker; the query just never said so. Widening
  `a.status != 'retired'` to `a.status NOT IN ('retired', 'done')` is the minimal fix that matches
  that intent exactly, with no schema or new enum needed (`done` and `retired` are both already in
  `AGENT_STATUSES`).
  - Alternative considered: make `cancel()` also set `retiredAt` (or fully retire the worker).
    Rejected — it would either archive/remove a worktree the ticket still needs (PLAN §11.5 says
    it must be kept until landed or discarded), or require inventing a new "retired but worktree
    kept" state that duplicates what `done` already means, for no behavioral gain over just fixing
    the query.

## Risks / Trade-offs

- [A `done` worker that is stuck in a way the stall watchdog was meant to catch would now go
  unnoticed] → this is not a live risk: no wake path exists for a `done` worker to be "stuck" on
  in the first place — it is not running, not queued, and nothing dispatches a turn for it. If it
  needs attention, the existing `worker.stalled`/decision plumbing keeps surfacing it through the
  cancel/relaunch comment already left on the ticket, not through this sweep.
