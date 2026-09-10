## Context

See `proposal.md` — Why, for the incident and the two blind spots in the existing watchdog
(`packages/core/src/supervisor/index.ts:137-185`). This design only covers how the new, independent
check is built.

Relevant existing shape, all already in `packages/core/src/supervisor/index.ts`:
- `livenessScan()` and `approvalIntegrityScan()` are the closest precedent: periodic (gated to the
  60s `LIVENESS_EVERY_MS` cadence, not every 15s tick), read-only detection passes that raise a
  system wake or log a warning rather than mutating anything.
- `retireIdleSessions()` is the closest precedent for the exact query shape: agents joined to
  tickets, filtered on `last_run_at` against a computed cutoff, with a `NOT EXISTS` guard against a
  running run.
- `worker.stalled` already exists as an event type, emitted by the live-run watchdog on interrupt,
  and is already a member of `DIGEST_EVENT_TYPES` — so emitting it is sufficient for the conductor to
  see it on its next digest; no new digest wiring is needed.
- `agents.last_run_at` is stamped at every turn's finalize (both a human message and the agent's own
  activity lead to one) — already relied on by `retireIdleSessions`.
- Schema already carries everything the check needs: `agents.status`/`ticket_id`/`last_run_at`,
  `tickets.status`, `decisions.ticket_id`/`status`, `wakeups.agent_id`/`status`,
  `runs.agent_id`/`status`. No migration.

## Goals / Non-Goals

**Goals:**
- Detect the VS-199 shape (clean `succeeded` run, no wakeup queued, ticket still open) without relying
  on run liveness at all.
- Reuse the existing fault-surfacing pattern exactly (`worker.stalled` event → digest), rather than
  inventing a new one.
- Keep the check fully independent of the live-run watchdog: no shared state, no shared code path, no
  change to its behaviour or its tests.

**Non-Goals:**
- Auto-resuming a stalled worker. Explicitly out of scope per the ticket — a parked worker may be
  parked for a reason this check cannot see, and automatic re-running could loop.
- A general agent health score. This is one narrow, precisely-defined condition.
- Covering the conductor or a hypothetical "curation agent": `AGENT_KINDS` is `['conductor',
  'worker']` only, and a conductor agent's `ticket_id` is always `null` (`workers/index.ts:196`), so
  the join this check performs on `agent.ticket_id = ticket.id` structurally excludes it. There is no
  third agent kind — curation is requested by the supervisor's own `curationPass` and actioned by
  whichever worker/conductor picks up the resulting ticket, not by a dedicated agent kind. This is
  stated in the PR per the ticket's request; it needs no code to enforce, only a test asserting a
  conductor-shaped row (kind `conductor`, `ticket_id IS NULL`) never matches.

## Decisions

### 1. A new `stalledWorkerScan` pass, gated on the same 60s cadence as `livenessScan`/`approvalIntegrityScan`

**Alternative considered:** run it on every 15s tick, like the live-run watchdog.

**Rejected because** the condition it detects only changes on the timescale of whole turns (minutes),
never within a single 15s tick; running it every tick would be one more `NOT EXISTS`-laden join query
per tick for no observable benefit. Piggybacking on the existing `if (Date.now() - lastLiveness >
LIVENESS_EVERY_MS)` block (`index.ts:660-664`) costs nothing new and keeps the precedent consistent:
that block is already exactly "the periodic detection passes," as distinct from the watchdog's
tighter interrupt loop.

### 2. One SQL query with `NOT EXISTS` subqueries, not a scan-then-filter in application code

Mirrors `retireIdleSessions`'s existing shape (a `JOIN` plus a `NOT EXISTS` guard against `runs`) and
extends it with two more `NOT EXISTS` guards (`decisions`, `wakeups`) and the terminal-status
exclusion. Filtering all five conditions in SQL keeps the row set small and the pass a single
read, consistent with every other supervisor pass reading agents/tickets in this file.

### 3. New config default `stalledWorkerTimeoutSec`, default 300 (5 minutes)

**Alternative considered:** reuse `spawnWaitWarnSec` (existing default 600s / 10 minutes), which
already expresses "how long is too long to wait for something that should have happened by now."

**Chosen instead:** a dedicated field, defaulted lower than `spawnWaitWarnSec`. The five conditions
this check requires (no open decision, no queued/claimed wakeup, no run in flight, non-terminal
ticket) already rule out every legitimate reason a healthy worker would be quiet — a worker correctly
waiting on a human or the conductor is excluded by the open-decision check, not by the timer. What
remains, once all five hold at once, is not a normal wait at any duration; it is a state a healthy
system should not produce. The timer's only real job is to absorb the ordinary latency between a run
finishing and its follow-up wakeup being enqueued (typically sub-second, per `finalize`'s own
retry/liveness enqueue calls right after updating `agents.last_run_at`), so it only needs to be
"comfortably longer than that latency," not "comfortably longer than a legitimate wait." Five minutes
is two turn-length ticks of headroom over any observed enqueue latency and well under the 20 minutes
VS-199 sat unnoticed — it would have been caught with 15 minutes to spare. Reusing
`spawnWaitWarnSec` would also conflate two unrelated concerns (a ticket waiting for a free role slot,
vs. an existing worker with nothing left to wake it) behind one config value, which a future change to
either would then have to reason about together for no reason.

### 4. Dedupe notifications in memory, keyed by `(agentId, lastRunAt)`, not in `meta`

**Alternative considered:** persist a "last notified" cooldown in `meta`, as `curationPass` and
`knowledgeHealthPass` do.

**Rejected because** those passes recur on a genuine cadence (a file becomes over-budget again days
later); a stalled worker's `last_run_at` does not change again until either it gets a new run (the
condition clears, full stop) or the daemon restarts. A single in-memory "already notified for this
`last_run_at`" record, cleared naturally the moment the worker gets a new run and its `last_run_at`
moves, is the whole lifecycle — no cooldown window to pick, no persisted key to prune. On a daemon
restart it notifies once more if the worker is genuinely still stuck, which is correct: the process
that would have remembered it already lost that same worker's real state.

## Risks / Trade-offs

- **[Risk]** A worker legitimately doing something outside the modelled states (e.g. a very slow
  finalize between the run ending and the follow-up wakeup landing) could be flagged as a false
  positive right at the threshold boundary. → **Mitigation**: the 5-minute threshold is chosen with
  wide headroom over observed enqueue latency (see Decision 3); this only ever produces a visibility
  event for a human/conductor to inspect, never an automatic action, so a false positive costs a
  glance, not a wrong resume.
- **[Trade-off]** The dedupe state is in-memory, so a daemon restart re-notifies once for a worker
  still genuinely stalled. → **Accepted**: cheap, and arguably correct — the daemon has no memory of
  ever having told anyone, so telling them again is right, not noisy.

## Migration Plan

No data migration. One new optional config field (`stalledWorkerTimeoutSec`, additive, defaulted) and
one new pure-read supervisor pass. Deploys as an ordinary code change: the next supervisor tick after
upgrade starts evaluating the new condition; nothing is backfilled or needs to be.
