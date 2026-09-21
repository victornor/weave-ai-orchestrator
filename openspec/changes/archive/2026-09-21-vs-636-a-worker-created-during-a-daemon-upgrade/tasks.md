## 1. A shared, idempotent worktree step

- [x] 1.1 Add `ensureWorktree(agentId)` to `WorkersService` in `packages/core/src/api.ts` and implement it in `packages/core/src/workers/index.ts`: a no-op when the worker's path is set and the directory exists; otherwise provision via the existing `provisionTicketWorktree`, update the row and worktree registry, and record the repair; serialised per agent id behind a re-read. Verify a unit test in `packages/core/src/workers/workers.test.ts` provisions a worker row whose `worktreePath` is null and leaves a healthy one untouched.
- [x] 1.2 Give the step its "needs a checkout" predicate (`kind === 'worker' && projectId && branch !== null`) and route `spawn`'s existing provisioning through it where it fits without changing spawn's rollback semantics. Verify the existing `workers.test.ts` spawn/provisioning tests still pass.

## 2. The run engine never runs a worker without its checkout

- [x] 2.1 In `packages/core/src/runs/engine.ts`, make the `prepare_worktree` phase call `ensureWorktree` for a worker needing a checkout and copy the resolved path/branch back onto the in-memory agent before `input.worktree`, `AC_WORKTREE` and the git identity are built. Verify a test in `packages/core/src/runs/engine.test.ts` where a worker with `worktreePath: null` runs a turn and the runtime's `input.worktree.path` is the created worktree.
- [x] 2.2 Fail the run with a clear, retryable error when provisioning cannot complete, and verify a test that the run fails with `errorFamily: 'transient_upstream'` and a retry wake is scheduled, with no runtime turn started.
- [x] 2.3 Verify a test that a knowledge-curation worker spawned without a worktree is not provisioned and its turn still runs from the primary clone path.

## 3. Relaunch and repair provision before going active

- [x] 3.1 In `workers.relaunch` (`packages/core/src/workers/index.ts`), provision a missing checkout before writing `status: 'active'` and queueing the relaunch wake. Verify a test in `workers.test.ts` that relaunching a worker with a null (or absent) worktree creates it, leaves `worktreePath` non-null and queues the wake.
- [x] 3.2 Verify a test that a relaunch whose provisioning fails does not leave the worker `active` with a null path (the relaunch fails and the row keeps its prior status).

## 4. Boot sweep resumes interrupted provisioning

- [x] 4.1 Add a boot-time sweep to `packages/core/src/supervisor/index.ts` (run with `bootRecovery` on the first tick) that provisions every worker needing a checkout whose path is null or whose directory is absent. Verify a test in `packages/core/src/supervisor/supervisor.test.ts` with one such worker and one healthy worker: the broken one gets a worktree and the healthy one is untouched.

## 5. The propose gate and OpenSpec reads name a missing checkout

- [x] 5.1 In `packages/core/src/openspec/index.ts`, detect a live worker whose checkout is missing and return, from `validateForProposed`, an issue stating the worker has no worktree and is being repaired. Verify a test in `packages/core/src/openspec/service.test.ts` (and/or `packages/core/src/tickets/tickets.test.ts`) that `proposed` is refused with that issue and not with "planning is not complete".
- [x] 5.2 Make `statusFor` report the same condition (a marker plus the issue) while a bound change with a worker that has a checkout is read exactly as before. Verify with tests in `openspec/service.test.ts`.

## 6. Integration and full verification

- [x] 6.1 Verify an integration test that simulates the incident: insert the worker row as a cut-off `spawn` leaves it (`provisioning`, null path, ticket bound), run the daemon's boot recovery/sweep, and assert the worker gets a worktree and a valid change's `proposed` gate then passes (rather than the transition reporting incomplete planning).
- [x] 6.2 Run the changed test files until green, then `pnpm lint`, `pnpm typecheck`, and one full `pnpm test` run with `VITEST_MAX_WORKERS=4`, pasting both suite blocks verbatim in the ticket report.
