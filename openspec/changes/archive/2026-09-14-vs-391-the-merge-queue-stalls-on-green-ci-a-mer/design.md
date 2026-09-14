## Context

See `proposal.md` for the incident and why. Three facts about the current code shape the approach:

- `createWakeService().scheduleSelfWake` (`packages/core/src/wake/index.ts`) cancels only queued
  self-wakes (`WHERE ... source = 'self_scheduled' AND status = 'queued'`) before inserting a new row
  with the stable key `self-wake:<agentId>`. The `wakeups_idem` unique index
  (`0001_init.sql`) covers `(agent_id, idempotency_key)` for any non-null key, so when the wake that
  started the current turn is `claimed` or `completed`, the cancel misses it and the insert collides.
- The supervisor's `reconcilePullRequests` (`packages/core/src/supervisor/index.ts`) already refreshes
  `prState`/`ciState`/`prChecks` onto `tickets.delivery_json`, but only for `in_review` tickets, and
  only inside `reconcilePass`, which is throttled to `RECONCILE_EVERY_MS` (one hour). It never wakes a
  merging ticket's worker.
- The merge queue report (`packages/core/src/tickets/merge-queue.ts` → `MergeQueueEntry`) carries only
  `startedAt`/`queuedAt`, so the UI can show an elapsed time but not what it is waiting on.

Two concurrent tickets touch nearby code: VS-389 (#325, in the merge queue) also edits
`packages/core/src/supervisor/index.ts` (`reconcileOpenSpecArchives`), and VS-393 will make ticket
pull requests drafts until the merge step marks them ready — hence the draft guard in Decision 3.

## Goals / Non-Goals

**Goals:**

- A worker's self-wake always supersedes its previous one, whatever status that row is in.
- The supervisor wakes a merging ticket's live worker on a check/merge-state transition, within one
  supervisor tick, keyed so a transition wakes at most once.
- The merge queue's active-merge display distinguishes CI wait from worker wait.

**Non-Goals:**

- Implementing the daemon-side "await checks while holding no lock, then merge" flow the
  `archive-before-merge` spec describes: this change only wakes the worker when the checks resolve;
  the worker still retries `weave_ticket_merge_done`.
- Changing merge concurrency, priority admission (VS-390), or the queue's landing sequence.
- Migrating the self-wake design to an in-place row update; the "cancel old, insert new" contract is
  kept.

## Decisions

### 1. Release the stable key from the old self-wake instead of only cancelling queued ones

`scheduleSelfWake` keeps its two-step shape. It first cancels the worker's queued self-wake (so
exactly one pending wake remains), then clears the stable idempotency key from **every** remaining
self-wake row for that agent — `claimed`, `completed`, `failed`, `cancelled` — before inserting the
new queued row. Clearing a key on a historical row changes no behaviour: `pendingSelfWake` and the
status views read by `source`/`status`, not by key, and `enqueue`'s Gate 0 only treats a key as live
for `queued`/`claimed`/`coalesced`/`completed` — which is exactly why the finished row had to release
it. *Alternative rejected:* upserting the existing row in place, because the current contract (and
`wake.test.ts`) expects a new row id and the old one cancelled; and inserting with a per-call random
key, because the stable key is what makes a duplicate call in the same turn idempotent.

### 2. Poll only the active merge, throttled, on the supervisor tick

A new supervisor pass, `wakeMergingOnProgress`, runs on every tick (15 s) and selects only tickets
that are **admitted to the active merge step** — `status = 'merging' AND merge_started_at IS NOT NULL`
— with a pull-request work product and a ready project clone. A merging ticket still waiting in the
queue (`merge_started_at IS NULL`) has no merge turn to wake and is never polled. The pass calls
`forge.prState(clone)` (a `gh` call, no `projects.fetch`), compares the result to the stored delivery,
writes the new state, and wakes the live worker on a transition. The per-ticket forge call is
throttled to about 30 s (an in-memory/stamped observation time per ticket), even though the tick
stays at 15 s, so a deep queue cannot multiply calls; with the default merge concurrency of one this
is at most a couple of `gh pr view` calls a minute, well under GitHub's authenticated rate limit
shared with the rest of the daemon's `gh` use. *Alternative rejected:* lowering `RECONCILE_EVERY_MS`,
because that pass also `git fetch`es every ready project and would become an every-tick git fan-out;
selecting every `merging` ticket, because the queued ones have nothing to wake; and relying on the
worker's self-wake alone, because that is the thing that was broken and it still polls on the
worker's schedule rather than the check's.

Forge calls are awaited, as the existing reconciliation pass is. A failing or slow forge is caught and
logged, leaving the stored state unchanged.

### 3. Transition detection and the wake key

The pass stores on the delivery `ciState`, `ciStateAt` (when the current `ciState` was first seen),
`prChecks`, `prState`, `ciHead` (the PR's head SHA) and, when the forge reports them, `mergeState`,
`mergeStateHead` and `isDraft`. A wake is enqueued when the pull request is not a draft and:

- `ciState` is `success` or `failure` **and** (`ciState` changed from the stored value **or**
  `ciHead` changed from the stored head) — a resolved rollup for a head not yet woken for; or
- `mergeState` became `clean` — a mergeable pull request — again keyed on `mergeState` or head having
  changed.

A `blocked` merge state is deliberately **not** a trigger: GitHub reports `BLOCKED` while required
checks are still running as well as when something else blocks the merge, and waking on it would wake
a worker that still has nothing to do. `blocked` becomes actionable only once the checks resolve,
which the `ciState` trigger already covers. A draft pull request is skipped entirely: VS-393 makes
ticket pull requests drafts until the merge step marks them ready, and a draft's absent checks must
never read as resolved.

The key is `merge-ci:<ticketId>:<head>:<ciState>` (or `merge-state:<ticketId>:<head>:<mergeState>`),
so a repeated pass over an unchanged PR finds a `queued`/`claimed`/`completed` row for the key and
does not stack a second wake. The head in the key is what re-arms a wake after the worker pushes a
fix. The wake uses source `merge_approved` with a reason naming the outcome; the existing
`mergeQueueLine` already tells the merging worker it holds the slot, so no new wake source or prompt
branch is needed. *Alternative rejected:* a dedicated `merge_checks` wake source, because it would
need a new enum value and prompt handling for no behavioural gain.

### 4. Optional merge state and draft flag on the forge adapter

`ForgeAdapter.prState` gains optional `mergeState?: 'clean' | 'blocked' | ...` and `isDraft?: boolean`;
`GhForge` requests `mergeStateStatus,isDraft` and lowercases the state. Both fields are optional so
existing fakes and adapters are unaffected, and the supervisor only acts on them when present.
*Alternative rejected:* skipping them, since the ticket names merge state as a trigger and VS-393's
draft pull requests need the draft flag to avoid a false resolved reading.

### 5. The wait split is the current phase

`ciStateAt` plus the current `ciState` is enough to say what an active merge is waiting on:

- `ciState === 'pending'` → waiting on CI for `now - ciStateAt`;
- otherwise (resolved or `none`) → waiting on the worker for `now - ciStateAt`, i.e. since the checks
  resolved.

`MergeQueueEntry` gains `ciState` and `ciStateAt`; the merge queue view shows the phase and its
duration for each active entry, and the board/V2 merge strip shows it for the longest-active ticket
(the ticket list already carries `delivery`, so `mergeStrip` reads the same fields). The strip keeps
its one-line, fixed-height shape — the addition is a short suffix on the existing active summary.
*Alternative rejected:* a second worker-activity timestamp, because the phase boundary is already the
check state and an extra poll of `agents.last_run_at` on the board query would be a broader change
than the ticket needs.

## Risks / Trade-offs

- **A per-tick `gh pr view` against the shared authenticated GitHub limit.** → Only admitted
  (slot-holding) merging tickets are polled, and each is throttled to ~30 s, so the default
  concurrency of one costs at most a couple of calls a minute; errors are caught and logged.
- **A stale `ciStateAt` if the supervisor restarts mid-wait.** → The next pass re-stamps on a state
  change; the worst case is an under-reported phase duration, not a missed wake.
- **The wake can fire once for a pre-push green head and again for the post-push head.** → Both are
  keyed per head; the first coalesces with the worker's own admit/merge turn, and the second is the
  real one. No duplicate merge is possible because `mergeDone` is idempotent per ticket status.
- **`mergeStateStatus` varies by forge.** → It is optional; a forge that omits it simply never
  triggers the merge-state branch.
- **Our interpretation of "the merge-queue strip".** → The ticket's phrase is read as both the board
  and V2 Work merge line and the merge queue view's active row; both read the same fields. If the
  reviewer wants only one surface, the display task is a subset.

## Migration Plan

No schema migration: the new fields live in the existing `tickets.delivery_json` and in transient API
responses. Defaults are absent/null until the first supervisor pass observes a merging ticket.

## Open Questions

None that change the specs or the task breakdown.
