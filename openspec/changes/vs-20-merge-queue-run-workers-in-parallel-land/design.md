## Context

See `proposal.md` — Why. The facts the design has to work with, verified against `main` at
`75c740e`:

- **Entering `merging` is a single funnel.** `transition()` in `packages/core/src/tickets/service.ts`
  is the only writer of the status, and line 314 (`if (to === 'merging') wake(...)`) is the only place
  the merge turn is started. Every caller — `applyMergeApproval`
  (`packages/core/src/decisions/service.ts:120`), `autoMergeSweep`
  (`packages/core/src/tickets/service.ts:715`), `reconcilePullRequests`
  (`packages/core/src/supervisor/index.ts:358`) and a direct API transition — goes through it. Putting
  the queue at that line covers all of them at once.
- **`merging` is already a worker status and a liveness status.**
  `packages/shared/src/transitions.ts:43-45`: `LIVENESS_STATUSES` includes `merging`, so a merging
  ticket with no live run and no queued wake is a liveness violation
  (`tickets/service.ts:722`, acted on by `supervisor/index.ts:202`); `WORKER_STATUSES` includes it, so
  `spawnPending` (`supervisor/index.ts:151`) spawns a worker for any merging ticket that has none.
  Both must learn about waiting tickets or the queue will thrash.
- **The primary clone is shared.** `landDelivery` (`packages/core/src/tickets/land.ts`) runs
  `git checkout`, `git merge --ff-only` and `git fetch` in `project.clonePath` — one directory shared
  by every ticket of the project. It has no lock. `openspec.archiveAfterMerge`, which runs immediately
  after it in `mergeDone`, already serialises per project with a promise chain
  (`packages/core/src/openspec/index.ts:84`).
- **Rows map themselves.** `ticketRow` (`packages/db/src/repos.ts:4`) passes every column through and
  the service reads `SELECT *`, so new columns reach the API and the tools with no mapping code — only
  the `Ticket` interface in `packages/shared/src/types.ts:7` needs the fields.
- **The plan.** `docs/PLAN.md` §11.4 describes an immediate merge on approval and §11.5 says
  "serialize only on declared blockers". This change contradicts that sentence deliberately, so it
  needs an ADR and a PLAN edit rather than a silent deviation (`CLAUDE.md`, "Deviations from the plan
  go in `docs/adr/`").

## Goals / Non-Goals

**Goals:**

- One funnel: exactly one place decides whether a merging ticket runs now or waits.
- Durable: the queue survives a daemon restart, because a merge takes many turns and hours.
- Self-healing: a queue whose head disappeared (worker parked, daemon killed mid-merge) advances on
  the supervisor tick without anyone acting.
- Additive: no new ticket status, no change to the approval flow, no migration that rewrites data.

**Non-Goals:**

- No timeout or eviction for a ticket that sits in the active merge step for a long time. A merge that
  cannot finish ends in `blocked` by the existing rules, which releases the slot; a slow merge is
  simply slow. Adding a deadline is a separate decision about what to do with half-merged work.
- No priority ordering. The queue is first-in-first-out by join time. Priority already decides which
  tickets get *built*; re-ordering the landing step by priority would let a high-priority ticket jump a
  branch that has already rebased onto main, and gain nothing.
- No cross-project ordering, and no automatic conflict resolution beyond what the merging worker does.
- No retirement of workers that are already alive while their ticket waits (see Decisions).

## Decisions

### D1 — Queue state lives on the ticket, not in a new table

Two nullable columns on `tickets`: `merge_queued_at` (joined the queue) and `merge_started_at`
(admitted to the active merge step). Waiting = `status='merging' AND merge_started_at IS NULL`;
active = `status='merging' AND merge_started_at IS NOT NULL`; position = rank of `merge_queued_at`
among the project's waiting rows, ties broken by `number`.

*Why:* the queue is a property of a ticket in one status, not an independent entity. There is exactly
one row per ticket either way, and a table would need its own lifecycle, its own foreign key, and its
own cleanup on cancel and on project removal. Columns also mean `SELECT *` already carries the state
to the API, the CLI and `ac_ticket_get`.

*Alternative considered:* a `merge_queue` table with `(project_id, ticket_id, position)`. Rejected:
stored positions have to be renumbered on every departure, which is the classic source of duplicate
and skipped positions. Deriving position from a timestamp cannot drift.

*Alternative considered:* an in-memory queue like `openspec`'s `serialize()`. Rejected: it is lost on
restart, and a merge spans many turns and can outlive the daemon process.

### D2 — Enqueue in `transition`, admit in one pump function

`transition()` stops waking the worker on `to === 'merging'`. Instead it stamps `merge_queued_at` (if
unset) and calls `mergeQueue.pump(projectId)`. Leaving `merging` clears both columns and pumps the
same project. `pump` is the only writer of `merge_started_at`; it counts the project's active rows,
admits waiting rows in order while `active < mergeConcurrency`, and for each admission stamps
`merge_started_at`, ensures a worker (`workers.spawnForTicket` when there is none) and enqueues the
`merge_approved` wake that used to fire in `transition`.

The wake keeps the `merge_approved` source and idempotency behaviour it has today, so the worker's
turn loop, the reconciliation wake at `supervisor/index.ts:360`, and the `agent-conductor-worker`
skill's `merging` row all keep working unchanged.

*Why one pump function:* admission is the only concurrency-sensitive step, so it is worth having
exactly one implementation of it, called from the three places that can change the answer (a
transition, a merge completing, the supervisor tick).

### D3 — The supervisor tick pumps every project

`pumpMergeQueues()` runs on the existing 15 s supervisor tick and pumps each project that has a
merging ticket. This is what makes the queue survive a restart and recover from a head that vanished
without a transition, and it is what satisfies the spec's "the queue recovers without a transition"
scenario. It is idempotent: a project already at its limit admits nothing.

### D4 — Waiting tickets are invisible to `spawnPending` and to the liveness scan

`spawnPending` skips tickets that are waiting in the queue, and `livenessViolations()` filters them
out. Without this, the liveness scan would wake a queued worker every minute with `liveness_repair`
and `spawnPending` would spawn a worker per waiting ticket, each burning a role slot to do nothing.

**Interpretation to confirm at plan approval:** the acceptance criterion "workers waiting in the queue
hold no worker slot beyond what they need to resume" is implemented as *the queue never demands a
worker*: no spawn while waiting, a spawn on admission. A worker that is already alive because it built
the ticket is left alone — it is holding the slot it held all through `in_review`, and retiring it
would throw away the session that knows the change, then have to rebuild a worktree to merge. If the
intent was instead to actively retire or park build workers while they wait, that is a larger change
(it needs a park state that survives worktree retention rules) and should be its own ticket.

### D5 — Concurrency is a project policy, default 1

`ProjectPoliciesSchema.mergeConcurrency: z.number().int().min(1).max(8).default(1)`, alongside
`mergeMethod` and `requireCi` in `packages/shared/src/config.ts:7`. Read through the same
`project.policies` path `landDelivery` and `autoMergeSweep` already use, so it is configurable in
`workspaces.yaml` and by `PATCH /projects/:id` with no new plumbing.

*Why a project policy and not a workspace default:* the constraint being modelled is one repository's
tolerance for concurrent landings. A workspace-wide number would be wrong for a workspace holding both
a busy monorepo and a quiet one. Projects already carry `maxWorkers`, so this is the same axis.

### D6 — Landing verification: four checks, cheapest first

`landDelivery`'s `pr` branch becomes, in order:

1. `git merge-base --is-ancestor <head> origin/<def>` — merge commit or fast-forward. (Unchanged.)
2. `git diff --quiet <head> origin/<def>` — identical trees. Catches a squash landed as the most
   recent commit, which is the common case and is what the acceptance criterion names.
3. Squash patch-id: `base = git merge-base origin/<def> <head>`; compare
   `git diff <base> <head> | git patch-id --stable` against the patch id of each commit in
   `git rev-list origin/<def> ^<base>` (`git diff-tree -p <c> | git patch-id --stable`). A match means
   the branch's whole change landed as one commit even though other work landed afterwards. Bounded to
   the commits the default branch gained since the merge base, so it stays cheap.
4. `git cherry origin/<def> <head>` with no `+` lines — every commit present individually
   (cherry-picked). Kept as the last check; it is the current implementation and it is correct for the
   case it was written for, just not for squashes.

*Why not replace `git cherry` outright:* it is the only check that recognises a branch whose commits
were picked one at a time, and it costs one process. Keeping it as a fallback loses nothing.

`LandResult.detail` names which check passed, so the activity record says how the merge was verified.

### D7 — Landing is serialised per project by the same mechanism as archiving

`mergeDone` wraps the `landDelivery` call in a per-project promise chain, the pattern already proven
at `packages/core/src/openspec/index.ts:84`. The helper moves to `packages/core/src/util/serialize.ts`
and both call sites use it, rather than a second copy.

*Why still serialise when the queue exists:* the queue's limit is configurable above 1, reconciliation
can call `mergeDone` outside the queue, and a lock over a `git checkout` in a shared directory is two
lines. Defence in depth for a race that corrupts a working tree is worth it.

### D8 — Visibility is one read model, three renderers

`mergeQueue.forProject(projectId)` returns `{ concurrency, active: QueueEntry[], waiting: QueueEntry[] }`
with `QueueEntry = { ticketId, identifier, title, position | null, queuedAt, startedAt }`. `GET
/projects/:id/merge-queue` returns it verbatim; `conductor ticket merge-queue [--project]` prints it as
a table; the web app renders it as a panel on the board and a "#2 in the merge queue" badge on the
ticket page, fed by the ticket detail payload's `mergeQueue` field so the ticket page needs no second
request.

*UI note carried into the tasks:* `packages/ui` route tests mock `../api/hooks` wholesale, so a new
hook must be added to each route test's mock in the same commit or those tests fail on a missing
export.

## Risks / Trade-offs

- **A stuck head stalls every ticket behind it.** With the default limit of 1, a worker that holds the
  active slot and neither merges nor fails keeps the whole project waiting. → The existing
  stuck-worker ladder (PLAN §11.6) ends in `blocked`, which releases the slot; the queue read model
  shows how long the head has held it, so a human can see it; and `mergeConcurrency` can be raised.
  No new timeout is introduced (Non-Goals).
- **Merges are slower end to end.** N tickets take N merge turns in sequence rather than in parallel.
  → That is the point: the parallel version corrupts the primary clone and produces
  `merge_unverified` failures that cost more turns than the wait.
- **The patch-id check can theoretically match the wrong commit.** Two commits with an identical
  cumulative diff would both match. → The search is bounded to commits the default branch gained since
  *this branch's* merge base, and an identical diff means identical content landed, which is the thing
  being verified. Ancestry and tree equality are tried first.
- **Skipping the liveness scan for waiting tickets could hide a genuinely stalled queue.** → The pump
  runs on every supervisor tick, so a waiting ticket is only ever one tick from admission once a slot
  frees; and a project stuck with a full active set is visible in the queue read model.
- **The interpretation in D4 may not be what was asked.** → Stated explicitly here so plan approval
  can correct it before any code is written.

## Migration Plan

One additive migration, `packages/db/src/migrations/0005_merge_queue.sql`: two nullable `TEXT` columns
on `tickets` and one index on `(project_id, merge_queued_at)`. Nothing is rewritten and no existing row
changes meaning — a ticket already in `merging` when the daemon upgrades has both columns null.

That ticket is the one case worth naming: it is neither waiting nor active by the new definitions. The
first pump after the upgrade treats a merging ticket with a null `merge_queued_at` as having joined at
its `updated_at`, so it is admitted first, ahead of anything queued after the upgrade. Its worker was
already woken before the upgrade, so the extra `merge_approved` wake it may receive is the same wake it
would get from a `liveness_repair` today.

Rollback is the standard one for this repo (`conductor daemon rollback`, no down-migrations): the older
daemon ignores the two columns and merges immediately on approval again, which is today's behaviour.

## Open Questions

None that can be deferred. The one judgement call that could change the task breakdown — how far
"holds no worker slot" goes — is stated as D4 for plan approval rather than left open.
