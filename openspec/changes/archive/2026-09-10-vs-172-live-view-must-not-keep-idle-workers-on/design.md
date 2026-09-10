## Context

See proposal.md for motivation. Live membership is `liveWorkingAgents`
(`packages/ui/src/lib/board.ts`): worker kind, a `ticketId`, status in
`provisioning|active|running`. A cell with no in-progress run renders “Waiting for the next turn.”
That between-turn cell is specified and stays.

Retirement today is a supervisor tick (`retireFinished` → `retireIfLanded`). `retireIfLanded`
refuses when the landed-work test fails and leaves the worker `active`. `propagateTerminal`
(`tickets/service.ts`) already runs on every path to `done`/`cancelled` (VS-142) but never touches
the worker.

PLAN §6.2: a cancelled ticket's worker goes to agent `done` with a dirty worktree until discarded.
Conductor 2026-09-10: retire when the ticket is done or cancelled; keep between-turn cells on open
tickets.

## Goals / Non-Goals

**Goals:**

- Worker status is not live by the time `transition` / `cancel` / `mergeDone` returns.
- Live drops the cell because the worker is no longer live — no new Live membership predicate.
- Unlanded worktrees are not force-deleted.

**Non-Goals:**

- Changing Live to require an in-flight run.
- Making `propagateTerminal` itself async (worktree IO stays scheduled).
- Telegram / TUI.

## Decisions

### 1. Sync status write in `propagateTerminal`, async land/archive

`cancel()` is synchronous and already inside `tx()`. `retireIfLanded` is async (git). Do not make
`cancel` async for this.

In `propagateTerminal`, after the VS-142 decision withdraw:

1. Select workers with `ticket_id = t.id`, `kind = 'worker'`, status not in `retired`/`done`.
2. For each: `wake.cancelForAgent`, set agent `status = 'done'`, mark its `active` worktree `dirty`,
   emit `worker.status`. Same write shape as `workers.cancel`, but no ticket comment from workers
   (that path calls back into tickets inside this tx).
3. `schedule(...)` `retireIfLanded` so a landed worktree is still removed and the home archived.

Live clients already patch on `worker.status`. The cell disappears without waiting for git.

**Alternatives:** await `retireIfLanded` inside `mergeDone` only — misses `cancel` and
`transition`. Call `workers.cancel` from `propagateTerminal` — nested tickets.comment inside the
cancel tx. Filter Live by ticket status — hides nothing extra once the worker is not live, and
would still show a leaked `active` worker if the core path failed.

### 2. `done` immediately, `retired` when land allows

Observable for Live is “not `provisioning`/`active`/`running`”. Full `retired` is the landed
cleanup. Unlanded cancel keeps PLAN’s dirty worktree. Supervisor `retireFinished` stays as
backstop for pre-existing leaks and to finish archive of workers already `done`.

### 3. Do not change `liveWorkingAgents`

Board and Live stay one predicate. UI tests assert a `done` worker is excluded (alongside the
existing retired/paused cases). Between-turn coverage (`Waiting for the next turn.`) stays green.

## Risks / Trade-offs

- [A running turn when the ticket is cancelled] → status `done` stops dispatch; schedule
  `runs.cancel` if a `running` row exists, same as `workers.cancel`. The cell is already gone.
- [retireIfLanded still fails on leftover dirty files after a merged done ticket] → worker is
  already `done`, Live is clear; worktree stays dirty until discarded. Same as today, without the
  Live leak.
- [Brief window before `worker.status` SSE] → same as any other status write; not a supervisor
  15s tick.

## Migration Plan

No schema. Already-leaked `active` workers on terminal tickets are picked up by the existing
`retireFinished` pass; if land still fails they stay `active` until a one-line follow-up or a
manual cancel. Out of this change’s apply unless a cheap “also mark `done` when land refuses on a
terminal ticket” falls out of the same helper. Rollback is revert; leftover cells return.
