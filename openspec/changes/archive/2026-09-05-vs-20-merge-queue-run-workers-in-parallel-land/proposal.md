## Why

Approving a merge today transitions the ticket straight to `merging` and wakes its worker
(`packages/core/src/decisions/service.ts:120` → `packages/core/src/tickets/service.ts:314`). Nothing
serialises what happens next. Approve two tickets in the same project and two workers race: both
rebase onto the same `main`, both run `gh pr merge`, and both call `ac_ticket_merge_done`, which runs
`landDelivery` — `git checkout`, `git merge --ff-only`, `git fetch` — in the **shared primary clone**
at the same time (`packages/core/src/tickets/land.ts:18`). The loser sees a clone left on the wrong
branch, a non-fast-forwardable base, or a `merge_unverified` error for work it actually merged. A
ticket that waits behind another finds its base has moved and only learns it when its own merge
fails. The system therefore cannot be pointed at ten parallel workers, which is exactly what the
workspace owner asked for: build wide, land narrow.

The same landing step carries a known defect. `landDelivery`'s squash fallback uses `git cherry`,
which compares per-commit patch ids; a squash merge collapses a multi-commit branch into one commit
whose patch id matches none of them, so every commit comes back as unmerged and the ticket is left
stuck in `merging` after a perfectly good merge. VS-9 had to be closed by hand on 2026-09-05 for this
reason. It is fixed here because it is the same step the queue hands work to.

## What Changes

- **A per-project merge queue.** Entering `merging` enqueues the ticket instead of starting its merge.
  A ticket carries the time it joined the queue and the time it was admitted to the active merge step;
  its position is the rank of its join time among the project's waiting tickets.
- **A configurable concurrency limit.** New project policy `mergeConcurrency` (integer ≥ 1, default 1)
  caps how many tickets of a project are in the active merge step at once. Only admitted tickets are
  woken to merge; the rest wait.
- **Admission, completion and failure pump the queue.** A ticket that leaves `merging` — merged,
  blocked, or sent back for changes — releases its slot and the next ticket is admitted immediately.
  A failed merge never holds the queue.
- **The queue is visible.** `GET /projects/:id/merge-queue` returns the active and waiting tickets with
  positions; `conductor ticket merge-queue` prints it; the web app shows the queue on the board and the
  ticket's own position on its page.
- **Landing verification accepts a squash of a multi-commit branch.** Ancestry first, then tree
  equality against the default branch, then a comparison of the branch's cumulative patch id against
  the commits the default branch gained — so a real merge is never reported as unverified.
- **Landing is serialised per project.** Even with `mergeConcurrency > 1`, the primary-clone mutation
  inside `ac_ticket_merge_done` runs one at a time per project, as the OpenSpec archive already does.
- **A queued ticket does not demand a worker.** While a ticket waits its turn, the daemon does not
  spawn a worker for it and the liveness scan does not treat it as stalled: the queue is its action
  path. A worker is (re)spawned when the ticket is admitted. Workers already alive from the build
  phase are left alone — they hold the slot they were already holding.

Not breaking: `merging` keeps its meaning and its place in the state machine, the approval flow is
untouched, and a workspace that never sets `mergeConcurrency` gets the safe default of one.

## Capabilities

### New Capabilities
- `ticket-delivery/merge-queue`: how an approved merge joins a per-project queue, how positions are
  ordered and reported, how the concurrency limit admits tickets to the active merge step, what
  happens when a merge fails or a ticket leaves the queue, and what a queued ticket costs in workers.
- `ticket-delivery/landing-verification`: what evidence the daemon accepts as proof that a ticket's
  branch has landed on the default branch, including a squash merge of a multi-commit branch, and the
  requirement that the primary clone is mutated by one landing at a time per project.

### Modified Capabilities
<!-- None: `openspec/specs/` currently holds only `conductor-chat/*` and `human-decisions/*`, neither
     of which describes delivery or merging. -->

## Impact

- `packages/shared` — `ProjectPoliciesSchema.mergeConcurrency`; the `Ticket` type gains
  `mergeQueuedAt` / `mergeStartedAt`.
- `packages/db` — one additive migration: two nullable columns on `tickets` plus an index. No data is
  rewritten and an older daemon ignores the columns.
- `packages/core` — `tickets/service.ts` (enqueue on entry to `merging`, release on exit, no direct
  wake), a new `tickets/merge-queue.ts` (admission, positions), `tickets/land.ts` (verification and
  per-project serialisation), `supervisor/index.ts` (pump on tick, skip queued tickets when spawning
  and in the liveness scan), `prompts/index.ts` (the merge turn says the ticket is at the front).
- `packages/server` — `GET /projects/:id/merge-queue`; queue position on the ticket detail payload.
- `packages/cli` — `conductor ticket merge-queue`.
- `packages/ui` — the merge-queue panel on the board and the position badge on the ticket page.
- Docs — `docs/API.md` for the new route, `docs/PLAN.md` §11.4/§12.2 for the queue in the merge flow,
  and an ADR recording the serialisation decision against §11.5's "serialize only on declared
  blockers".
