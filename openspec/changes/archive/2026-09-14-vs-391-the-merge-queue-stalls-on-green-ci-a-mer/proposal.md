## Why

Merges are strictly one at a time per project (`DEFAULT_MERGE_CONCURRENCY = 1`), so the ticket holding
the single merge slot must be woken promptly when its pull request's checks resolve. On 2026-09-14,
VS-367 held that slot while PR #317's CI ran. Its worker's `weave_schedule_wakeup` call failed every
time with `UNIQUE constraint failed: wakeups.agent_id, wakeups.idempotency_key`, because the wakeup
that had started its current turn was already `claimed`/`completed` and still held the stable
self-wake key, so the replacement insert collided. The worker ended its turn relying on a liveness
sweep, CI went green at 01:40:52Z, and the ticket sat idle past 01:45Z with seven tickets queued
behind it until the weaver woke it by hand. Everything the queue was waiting for — a wake that works
when the checks finish — did not exist. With each merge already costing 8–10 minutes, an idle slot
multiplies across the queue.

## What Changes

- **Self-wake replacement works whatever state the previous self-wake is in.** A second
  `weave_schedule_wakeup` for one worker supersedes its previous pending self-wake even when that row
  is `claimed`, `completed` or `failed`, leaving exactly one queued self-wake (the latest) and never
  colliding with the old row's stable idempotency key. The "one pending self-wake per worker"
  contract is unchanged.
- **The supervisor wakes the merge-slot worker when its checks resolve.** Only tickets in a project's
  active merge step are polled, on the supervisor's own fast tick (not the hourly reconciliation
  pass) and throttled per ticket to bound forge calls. When a ticket's check rollup resolves — or its
  merge state becomes clean — the ticket's live worker is woken once per transition, with the outcome
  in the payload. A `blocked` merge state while checks are still running wakes nobody, and a draft
  pull request never reads as resolved. A merge turn then starts on the next supervisor pass after CI
  finishes, without the worker polling itself.
- **The merge queue shows what the active merge is waiting on.** The active-merge display reports the
  wait split between CI (the merge is waiting for checks) and the worker (the worker has not acted
  since), so a stalled slot is visible instead of a bare elapsed time.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-tools/self-scheduled-wake`: the "a second schedule replaces the first" requirement is
  strengthened — replacement must succeed regardless of the previous self-wake's status, and the
  stable idempotency key must never collide with a non-queued row.
- `ticket-delivery/merge-queue`: adds that the active merge's worker is woken once per CI/merge-state
  transition, and that the active-merge display reports the CI-versus-worker wait.

## Impact

- `packages/core/src/wake/index.ts` — `scheduleSelfWake` replacement query.
- `packages/core/src/supervisor/index.ts` — a new merging-ticket progress pass run per supervisor
  tick, and the `ciStateAt` stamp it records on the ticket delivery.
- `packages/core/src/api.ts` — `MergeQueueEntry` gains the active merge's CI state / since and the
  worker's last turn time; `ForgeAdapter.prState` optionally reports a merge state.
- `packages/plugin-sdk/src/index.ts` / `packages/core/src/forge/gh.ts` — optional `mergeState` and
  `isDraft` on `prState`, read from `gh`'s `mergeStateStatus` and `isDraft`.
- `packages/ui` — the merge queue view / board and V2 Work merge strip render the wait split.
- `docs/API.md` — the merge-queue entry shape.
- Tests: `packages/core/src/wake/wake.test.ts`,
  `packages/core/src/supervisor/supervisor.test.ts`, plus UI/render tests for the display.
