## Why

On 2026-09-10, VS-147 still occupied Live as “Waiting for the next turn” after the ticket was
`done` (merged PR #118). Its worker stayed `active` with `retiredAt` null. Live is the working set
of current owners, not parked leftovers. Completing or cancelling a ticket must take its worker out
of that set in the same transition, not on a later supervisor pass that can refuse to retire.

## What Changes

- When a ticket reaches `done` or `cancelled` (every path: `transition`, `cancel`, `mergeDone`),
  its worker SHALL leave live statuses (`provisioning` / `active` / `running`) in that same
  transition. Live (`/w/:ws/live` and global `/live`) then has no cell for it.
- If the worktree can be removed, the worker is fully `retired` (home archived, wakes cancelled).
  If the worktree is unlanded, the worker is `done` and the worktree stays dirty until discarded —
  same shape as `workers.cancel` today — so Live still drops it without deleting unlanded work.
- Live membership is unchanged: still live workers on tickets, including between-turn cells on
  **open** tickets. Conductor decided 2026-09-10 (`narrow`): do not hide idle cells on in_progress /
  in_review tickets.
- Supervisor `retireFinished` remains a backstop for already-leaked rows and for finishing worktree
  cleanup of workers already marked `done`.

## Capabilities

### New Capabilities

- `worker-supervision/terminal-retirement`: a ticket reaching `done` or `cancelled` takes its
  worker out of the live set in that transition; full `retired` when the worktree can be removed,
  otherwise `done` with a dirty worktree.

### Modified Capabilities

- `workspace-navigation/live-floor`: a worker whose ticket has reached `done` or `cancelled` has
  no cell. Between-turn cells on open tickets stay.
- `workspace-navigation/global-live`: the same membership consequence as per-workspace Live.

## Impact

- `packages/core/src/tickets/service.ts` — `propagateTerminal()` releases the worker (VS-142’s
  chokepoint).
- `packages/core/src/workers/index.ts` — a sync “leave the live set” path; `retireIfLanded` still
  does landed cleanup.
- Tests: `packages/core/src/tickets/tickets.test.ts` (ticket → done/cancelled ⇒ worker not live);
  `packages/ui/src/test/board.test.tsx` / `liveFloor.test.tsx` (a `done`/`retired` worker is not in
  the working set). Existing between-turn Live coverage stays.
- No API, schema, CLI, Telegram or TUI change.

## Out of scope

- Telegram / TUI.
- Hiding between-turn Live cells on open tickets.
- Changing what a paused worker shows (VS-137).
- Force-deleting an unlanded worktree on cancel.
