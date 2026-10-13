## Why

On 2026-09-20 a V OFM worker (Deployment Engineer #16, ACME-130) was created at 21:14:22Z, inside a
daemon restart window, so `spawn()` never finished `provisionTicketWorktree`. The row was left
`provisioning` with `worktreePath = null`. A later relaunch flipped it to `active` without creating a
checkout, so every turn ran with `hasWorktree: false`, the daemon could not read the ticket's
OpenSpec change (`weave_openspec_status` reported empty artifacts and the `proposed` gate blamed
incomplete planning), and the worker could never get past its propose phase. It had to be replaced by
hand. The system treats "the row says active" as "the worker is ready to run", and nothing between a
restart and a turn ever re-checks the checkout it depends on.

## What Changes

- A worker that needs a checkout is provisioned **before its turn runs**: the run engine's
  `prepare_worktree` step creates a missing worktree (null path or absent directory) instead of
  skipping, and fails the run with a clear, retryable error when it cannot.
- A **relaunch** (and any liveness repair that goes through it) provisions a missing checkout first;
  it never marks a worker `active` with a null path.
- A **startup sweep** resumes provisioning a worker whose worktree was interrupted by a restart —
  chosen over deferring the spawn, because the worker row and the ticket's `worker_id` already exist
  and nothing else will ever finish them.
- The **propose gate and OpenSpec reads name the missing checkout**: when the daemon cannot read a
  worker's change because the worker has no worktree, the transition and `weave_openspec_status` say
  "this worker has no worktree; it is being repaired", not "planning is not complete".
- The self-heal is **visible**: a repair logs and records an activity entry naming the worker.

The retired ACME-130 worker and ticket are untouched.

## Capabilities

### New Capabilities

- `worker-provisioning/worktree-provisioning`: the invariant that a worker needing a checkout has one
  before it runs, that repair and relaunch provision rather than merely mark active, that a restart
  resumes an interrupted provisioning on boot, and that any such repair is visible.

### Modified Capabilities

- `openspec-mode`: add a requirement that the `proposed` gate reports a missing worker checkout as
  itself, rather than as incomplete planning.
- `agent-tools/openspec-status`: add a requirement that `weave_openspec_status` reports a missing
  worker checkout in the returned status rather than showing an empty change.

## Impact

- `packages/core/src/workers/index.ts` — a shared, idempotent `ensureWorktree` used by spawn, relaunch
  and the startup sweep.
- `packages/core/src/runs/engine.ts` — the `prepare_worktree` phase provisions a missing checkout and
  fails retryably when it cannot, and the in-memory agent carries the resolved path for the turn.
- `packages/core/src/supervisor/index.ts` — a boot-time sweep over `provisioning`/`active` workers
  whose checkout is missing.
- `packages/core/src/api.ts` — the `WorkersService` surface for the shared step.
- `packages/core/src/openspec/index.ts` — missing-checkout detection and message for `statusFor` and
  `validateForProposed`.
- Tests: `packages/core/src/workers/workers.test.ts`, `packages/core/src/runs/engine.test.ts`,
  `packages/core/src/supervisor/supervisor.test.ts`, `packages/core/src/openspec/service.test.ts`.
- No schema or migration change; the worker/agent row already carries `worktree_path` and `branch`.
