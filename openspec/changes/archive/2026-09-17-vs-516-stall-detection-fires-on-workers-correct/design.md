## Context

VS-498 added bounded automatic recovery to the stalled-worker sweep. `stalledWorkers()`
(`packages/core/src/supervisor/index.ts:579-604`) selects every worker agent whose ticket is not
terminal or `blocked`, that has no open decision, no queued/claimed action-path wakeup, no
queued/running run, and whose `last_run_at` is older than `stalledWorkerTimeoutSec`. `stallRecoveryScan()`
then creates a `worker_stall_state` row, enqueues a `system` recovery wake up to the cap, and finally
raises a weaver-owned `gate_finding`.

That predicate omits a legitimate wait the system now has: **waiting for merge-queue admission**. The
merge queue (`packages/core/src/tickets/merge-queue.ts`, PLAN §11.4) admits one ticket per project at
a time. A ticket that has entered `merging` but is not yet admitted is exactly `status = 'merging'
AND merge_started_at IS NULL`. The queue's `pump()` runs on the supervisor tick and on every slot
free, stamps `merge_started_at`, and enqueues a `merge_approved` wake for that same worker. So while
waiting there is no queued wake and no running run — the two conditions the predicate reads as "no
route back" — but there is one, and it is owned by the queue, not by a `wakeups` row.

`spawnPending()` already encodes this same distinction for a different purpose:
`NOT (status = 'merging' AND merge_started_at IS NULL)` (`supervisor/index.ts:330`), so a waiting
ticket is not staffed until it is admitted. This change reuses that exact condition in the stall
predicate.

Observed live 2026-09-17 20:02Z on VS-513: a queued worker ended its turn `paused` with an accurate
account, no scheduled wake (correct — the merge queue wakes it), and was nudged twice then escalated.

## Goals / Non-Goals

**Goals**
- A worker whose ticket is waiting for merge-queue admission is never detected as stalled, nudged,
  escalated, or persisted as being in a stall/recovery cycle.
- The exclusion stays narrow: a worker that holds the slot (`merge_started_at` set) remains a stall
  candidate, so the VS-391 case (a slot holder with green CI whose wake failed) is still caught.
- State plainly how long a queued worker may wait and whether a bound applies.

**Non-Goals**
- Changing the merge queue's admission order, concurrency or aging.
- Changing VS-498's recovery/escalation ladder, `stallRecoveryScan`, or the `worker_stall_state`
  table shape.
- Adding a new waiting-age timeout (see Decision 3).
- The merge-slot CI alarm (VS-467, `mergeChecksAlarmSec`) — a separate, already-existing mechanism.

## Decisions

### 1. Signal: `merging` with `merge_started_at IS NULL`, not a `merging`-status exemption

The queue's own definition of "waiting" is `merge_started_at IS NULL` — the module docstring says
"Waiting = merging with no start; active = merging with one", and `waitingOf()`/`activeOf()` are
exactly those two queries. `merge_started_at` is the only column the queue writes on admission
(`admit()`), and it is cleared on `leave()`. `merge_queued_at` alone is a weaker signal: it is
backfilled by `pump()` for a ticket that was already `merging` when the daemon upgraded, so a
waiting ticket can briefly have it null, whereas `merge_started_at` is null for the whole wait.

Excluding the whole `merging` status was explicitly ruled out by the ticket, and rightly: it would
mask a slot-holding worker that genuinely stalled, which is the case the detector exists for. The
condition is therefore added to the `stalledWorkers()` WHERE clause as
`AND NOT (t.status = 'merging' AND t.merge_started_at IS NULL)`, mirroring `spawnPending()`.

### 2. Clearing the persisted fact when a worker enters the queue wait

`stallRecoveryResetPass()` walks every `worker_stall_state` row and clears it when a subsequent
recovered run left observable evidence. Requesting landing itself changes the ticket's status
(`runProducedEvidence()` counts a `ticket.transition`), so in the ordinary path the row is already
cleared when the ticket becomes `merging`. To keep the reads honest even on a path where no
qualifying run is seen, the reset pass also deletes the row when the worker's ticket is in the
merge-queue wait — a queued worker is by definition not in an active stall/recovery cycle. This is a
small, additive clause; it does not touch the recovery ladder.

### 3. No age bound on a queued worker; the bound is the slot holder's supervision

The ticket asks how long a legitimately queued worker may wait before it is worth flagging anyway.
**No separate bound applies, and this is deliberate.** A waiting ticket's wait is bounded by the slot
it is queued behind, and the slot holder is supervised by two existing mechanisms:

- **VS-467's merge-checks alarm** (`mergeChecksAlarmSec`, default 1200s / 20 min) comments on the
  ticket and wakes the conductor when a non-draft slot holder's checks stay unresolved past the
  threshold.
- **This same stalled-worker detection**, which still applies to a slot holder (`merge_started_at`
  set): if the holder's worker goes quiet — its admit wake failed, as in VS-391 — it is detected and
  recovered/escalated like any other worker.

So a queue that never drains is never silent: it always resolves to a slot holder that is itself
surfaced. A second timeout on the waiters would duplicate that escalation and would fire precisely
when a backlog is legitimate — several tickets landing together, the scenario this change exists to
stop mis-reading. The reasoning is recorded in the delta spec so it is not silently reversed later.

### 4. The exclusion lives in one place, so recovery and escalation inherit it

`stallRecoveryScan()` iterates `stalledWorkers()`, so excluding the wait at the predicate removes the
queued worker from recovery, escalation and the `worker.stalled` event in one edit. No separate guard
is added in the scan.

## Risks / Trade-offs

- **A queue whose slot holder is a live, healthy worker stuck on long-but-progressing CI.** Not a
  silent stall: VS-467 alarms the conductor at `mergeChecksAlarmSec`, and the holder keeps its own
  poll loop (`wakeMergingOnProgress`). The waiters are not flagged, which is correct while the head
  is being supervised.
- **A queue that cannot admit because the head has no role to bring a worker.** `pump()` logs a
  warning and retries each tick; this is a staffing fault, not a stall of the waiters. Out of scope
  here; if it needs its own surface it is a separate ticket.
- **A stale `worker_stall_state` row surviving into the queue wait.** Closed by Decision 2: the reset
  pass deletes it, and a regression test asserts the read goes back to not-stalled.

## Migration Plan

None. `merge_started_at` and `worker_stall_state` already exist; the change is a predicate clause and
a reset clause. No config, schema or API change. Rollback is reverting the two clauses.

## How long a queued worker may wait (per the ticket's acceptance criterion)

Indefinitely, with no waiters-only timeout, because the wait is transitively bounded: the queue pumps
every supervisor tick, admits as soon as a slot frees, and the slot holder is covered by VS-467's
20-minute merge-checks alarm and by this detector if its worker goes quiet. A queue that never drains
is a real fault, and it surfaces through the holder, not through the waiters.
