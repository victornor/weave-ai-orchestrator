## Context

See `proposal.md` — Why. The relevant current state:

- `spawn()` in `packages/core/src/workers/index.ts` inserts the agent row `provisioning` with
  `worktreePath: null`, then calls `provisionTicketWorktree` and only then sets the row `active` and
  queues the first wake. A daemon restart inside that window kills the process with the row already
  inserted and `tickets.worker_id` already bound, so `spawnPending` (which only acts on tickets with
  `worker_id IS NULL`) will never resume it.
- The run engine skips `prepare_worktree` entirely when `agent.worktreePath` is falsy
  (`packages/core/src/runs/engine.ts:498`), so a worker with a null path runs its turn in its home
  directory with no checkout.
- `relaunch` (`workers/index.ts:720`) unconditionally writes `status: 'active'` and queues a wake; it
  never looks at `worktreePath`.
- `OpenSpecService.resolve()` (`openspec/index.ts:110`) falls back to the project's primary clone when
  the worker has no worktree, so `validateForProposed` reads a change that is absent there and reports
  "planning is not complete" instead of the real condition.

## Goals / Non-Goals

**Goals:**

- A worker needing a checkout has one before any turn runs, however it got into the broken state.
- A worker created during a restart resumes provisioning on boot without human action.
- A relaunch/retry never marks such a worker active with a null path.
- The propose gate and `weave_openspec_status` name the missing checkout instead of blaming the plan.
- Every out-of-spawn repair is logged and recorded as activity.

**Non-Goals:**

- Changing the worktree provider, branch naming, or landing behaviour.
- Re-provisioning a worker that legitimately has no checkout (curation workers, persistent sessions).
- Any schema change; `agents.worktree_path` and `agents.branch` already carry what is needed.
- Touching the retired ACME-130 worker or ticket.

## Decisions

**1. One idempotent `ensureWorktree(agentId)` on `WorkersService`, used by all three callers.**
It re-reads the agent, returns immediately when `worktreePath` is set and the directory exists, and
otherwise calls the existing `provisionTicketWorktree`, updates the row and the worktree registry, and
records the repair. Putting it on the service keeps the provider, git-identity and rollback logic in
one place rather than reimplementing provisioning in the engine and the supervisor.
*Alternative considered:* provision only inside `spawn` and make `spawn` resumable — rejected because
the caller that recovers a mid-restart worker (a run dispatch, or the boot sweep) has no spawn
context.

**2. "Needs a checkout" is `kind === 'worker' && projectId && branch !== null`.**
`spawn` already writes `branch: null` for `noWorktree` agents, which today means a curation worker
whose project has no knowledge repo. Persistent sessions are `kind = 'session'`, never `'worker'`.
This keeps the existing no-worktree curation path (`engine.ts:647`) working unchanged.
*Alternative considered:* `originKind !== 'curation'` — rejected because it duplicates knowledge about
curation that is not the real condition; a curation ticket that opted into a knowledge repo *does* get
a worktree and must be covered.

**3. The engine's `prepare_worktree` provisions, and a failure is retryable.**
When the worker needs a checkout, the phase calls `ensureWorktree` (updating the in-memory agent from
its result so `input.worktree`, `AC_WORKTREE`, the git identity and the brief all see the path), then
fetches as it does today. A provisioning failure throws an `OcError` with family
`transient_upstream` — the retryable "transient" family in `RETRYABLE` (`engine.ts:68`) — so the
existing 30 s / 2 min / 10 min ladder retries it and parks for the human when spent. The phase still
never resets, cleans or switches an existing worktree.
*Alternative considered:* `resource` (also retryable) — rejected only for naming: the ticket asks for
the transient family, and host-tool retryability is the same either way.

**4. A boot-time sweep in the supervisor, not deferred creation.**
`bootRecovery` already runs once on the first tick. A sibling `reprovisionMissingWorktrees()` finds
workers needing a checkout whose path is null or whose directory is absent and calls `ensureWorktree`
for each, recording the activity it produces. This is chosen over "create after the restart" because
the orphaned row and its ticket binding exist before the daemon dies, so without a sweep nothing in
the system owns finishing them.
*Alternative considered:* have `bootRecovery` re-drive `spawn` for tickets bound to a dead worker —
rejected because it would have to distinguish a worker that was mid-spawn from one that has existed for
hours, and would risk a second agent on the same ticket.

**5. Idempotency under an in-process race.**
`ensureWorktree` serialises per agent id behind a promise map and re-reads the row after acquiring it.
The sweep runs at boot when a spawn may still be in flight for the same agent; without this a slow
spawn and the sweep could both call the provider. The map lives in the workers service, which is a
per-workspace singleton.

**6. Missing-checkout detection for the OpenSpec reads.**
A helper distinguishes "no live worker" (fall back to the primary clone, as today — the weaver can
still validate) from "a live worker with no checkout" (the new message). `validateForProposed` returns
that as its single issue; `statusFor` returns the zeroed-but-enabled status with the same issue in
`validation.issues` and a `worktree: 'missing'` marker, so a caller can tell it from unplanned.

## Risks / Trade-offs

- [A worker's recorded path points at a directory another process removed] → `ensureWorktree` treats a
  missing directory as missing and recreates; the provider is given the worker's existing branch, and a
  failure to recreate surfaces as the retryable error rather than silent damage.
- [The boot sweep races an in-flight spawn in the same process] → per-agent serialisation and a
  re-read (Decision 5); the sweep also only reads and repairs, never removes.
- [A permanent provisioning failure (e.g. missing git identity) is retried three times] → bounded by
  the existing ladder, then parked for the human with the real message, which is the intended
  behaviour for a broken host condition.
- [A test harness that inserts a worker by hand with a null path now triggers provisioning in the
  engine] → intended; the harness and its fixtures are updated with the tests, and the no-worktree
  branch is covered explicitly.

## Migration Plan

No schema or data migration. A daemon running the new code repairs existing broken rows on its first
boot sweep, so the fix also clears any worker left in the incident's state. Rollback is a code revert;
no persisted format changes.

## Open Questions

None that change the specs or tasks.
