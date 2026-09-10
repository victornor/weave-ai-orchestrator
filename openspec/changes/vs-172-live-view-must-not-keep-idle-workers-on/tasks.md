## 1. Release the worker when the ticket becomes terminal

- [x] 1.1 In `packages/core/src/tickets/service.ts` `propagateTerminal`, after the VS-142 decision withdraw, for every worker with `ticket_id = t.id`, `kind = 'worker'`, status not `retired`/`done`: cancel its wakes, set status `done`, mark its `active` worktree `dirty`, emit `worker.status`. If a `running` run exists, `schedule` `runs.cancel`. `schedule` `retireIfLanded` so a landed worktree is still removed. Verify a ticket with an `active` worker `cancel()`led from `todo` leaves that worker not in `provisioning`/`active`/`running` (`packages/core/src/tickets/tickets.test.ts`; stub `wake.cancelForAgent` and `workers.retireIfLanded` on the existing harness).

- [x] 1.2 Same path via `transition` to `done` (a `task` `in_progress → done` with a live worker). Verify the worker is not live after `transition` returns, without waiting for a supervisor tick. Already-`retired` workers stay `retired`. A ticket with no worker still transitions.

- [x] 1.3 In `packages/core/src/supervisor/index.ts` `retireFinished`, when `retireIfLanded` returns `retired: false` for a worker whose ticket is already terminal, set that worker to `done` (wakes cancelled, worktree dirty) instead of leaving it `active`. Verify the existing “retires workers whose ticket is terminal” test still calls `retireIfLanded`, plus a new case: land refuses → worker status `done`, not `active` (`packages/core/src/supervisor/supervisor.test.ts`).

## 2. Live membership follows worker status (no new predicate)

- [x] 2.1 In `packages/ui/src/test/board.test.tsx` `liveWorkingAgents`, assert a worker with status `done` and a `ticketId` is excluded (alongside the existing paused/retired/conductor cases). Verify that test fails on current main (it is not listed today) and passes after the assertion is added — membership code itself should not change.

- [x] 2.2 In `packages/ui/src/test/liveFloor.test.tsx`, add: an `active` worker on a ticket is a cell; after that worker’s status is `done` or `retired`, the cell is gone and “Nobody is working.” shows if it was the last one. Keep the existing “Waiting for the next turn.” between-turn test green.

## 3. Verification

- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm test` green.

- [x] 3.2 `openspec validate vs-172-live-view-must-not-keep-idle-workers-on --json --strict` clean.
