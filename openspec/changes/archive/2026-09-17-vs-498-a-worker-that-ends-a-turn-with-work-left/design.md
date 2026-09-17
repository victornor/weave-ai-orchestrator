## Context

VS-202 already added `stalledWorkers()` (`packages/core/src/supervisor/index.ts:571-590`) and
`stalledWorkerScan()` (594-604), invoked from the supervisor's 15s tick (`TICK_MS`, line 20) at
line 1359. `stalledWorkers()` is a single SQL query already excluding every legitimate wait: a run
queued/running, a wakeup that's a live action path (including a not-yet-due self-wake, with a grace
margin `SELF_WAKE_STALL_GRACE_MS`), an open decision, a terminal ticket, and an interactive session.
`stalledWorkerScan()` only emits an `events.emit('worker.stalled', ...)`, deduped per
`(agentId, lastRunAt)` via an in-memory `stalledNotified` map — a comment explicitly says "Detection
only... nothing here enqueues a wakeup, retry or restart." That event enters the conductor's digest
(`conductorDigest()`, 671-744) as one entry among up to 30, drawn from the last 200 activity events
since the digest's own cursor — once it scrolls out, nothing re-asserts the worker is still stalled.

Separately, `packages/render/src/entities.ts`'s `workerToCard()`/`ticketToSummary()` already accept a
`stalled`/`workerStalled` boolean and feed it into `agentUiStatus()`/`ticketUiStatus()`
(`packages/shared/src/ui-status.ts`), which already produce a distinct `stalled` UI status with its
own glyph and color, defined all the way through `packages/render/src/status.ts` and
`packages/ui/src/lib/status.ts`. But every actual call site —
`packages/server/src/presenter.ts:49` (`agentUiStatus(a.status)`) and
`packages/presenter/src/views.ts:32` — calls these functions positionally, without the flag, so the
`stalled` status is fully built and never reachable.

The nearest precedent for "bounded automatic attempts, then hand to a human/weaver" is the run
engine's retry ladder (`RETRY_BACKOFF_MS`, `engine.ts:42`, `countRetries()` 826-836) and the
stuck-worker `gate_finding` (`engine.ts:788-815`): three consecutive empty/idle turns with no
observable evidence of progress raise a weaver-owned `gate_finding`, correlation-keyed per agent so it
doesn't re-fire. This change reuses that same evidence test (`runProducedEvidence`, 179-191) and the
same `decisions.create(..., kind: 'gate_finding', owner: 'weaver', correlationKey: ...)` escalation
shape, applied to a different trigger: not "three turns did nothing," but "this worker's clean stop
was not followed by anything, twice, despite being nudged."

## Goals / Non-Goals

**Goals:**
- Turn today's one-shot `worker.stalled` event into bounded, safe, automatic recovery, with a hard
  stop that hands off to the weaver instead of retrying forever.
- Make the already-built `stalled` UI status actually reachable from real data, on the workers read,
  the tickets read, and the workspace push stream.
- Do this by extending the sweep and the existing wake/decision machinery — no new dispatch path, no
  new kind of agent.

**Non-Goals:**
- Changing why or when a worker chooses to end a turn early. Ending at a clean committed point stays
  correct behavior.
- Redesigning the digest's event window or size bounds.
- The mid-turn silence watchdog (`runs.status = 'running'` gone quiet) — a different, already-handled
  condition, explicitly out of scope per the ticket.
- Changing the stuck-worker gate's three-empty-turns logic itself; this only reuses its evidence test.

## Decisions

### Persisted state: a new `worker_stall_state` table, not new `agents`/`tickets` columns

A new table, one row per worker currently in (or having ever entered) an active stall/recovery cycle:

```sql
CREATE TABLE worker_stall_state (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_detected_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_attempt_wake_id TEXT,
  escalated_at TEXT,
  escalation_decision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

A row exists exactly while the worker is "in an active stall/recovery cycle" per the spec. It is
deleted (not soft-cleared) once evidence of progress is found, or once its escalation decision
resolves and no new stall is currently detected — so "does a row exist" is itself the persisted fact
the reads surface, with no separate boolean to drift out of sync. A dedicated table, rather than
columns on `agents` or `tickets`, keeps this transient bookkeeping out of the two hottest, most
generally-read tables, and lets it be dropped and recreated per worker without touching rows every
other query already joins against.

Alternative considered: encode the attempt count in the recovery wakeups themselves (count prior
`wakeups` rows with a recognizable reason/payload marker for the agent since the last evidence of
progress). Rejected: it requires scanning wake history on every sweep tick instead of a single
indexed row lookup, and "since the last evidence of progress" has no natural anchor in the wake table
the way it does in a dedicated row that is deleted exactly when that happens.

### Recovery wake uses the existing `system` wake source, not a new enum value

The recovery wakeup is enqueued through the existing `wake.enqueue()` funnel with `source: 'system'`
and a `payload.kind: 'stall_recovery'` marker plus a human-readable `reason` string naming the attempt
number — the same pattern the existing review-reminder wake already uses for a distinct system-raised
nudge (`supervisor/index.ts:550-556`). `idempotencyKey` is `stall-recovery:<agentId>:<attempts+1>`, so
a sweep tick that runs twice before the row's `attempts` write is visible cannot double-enqueue.

Alternative considered: add a dedicated `stall_recovery` value to `WAKE_SOURCES` and the `wakeups`
table's `CHECK` constraint. Rejected for this change: SQLite has no `ALTER TABLE ... ADD CHECK`, so
widening that enum means a full-table rebuild migration for a value whose only consumer is this one
sweep; `payload.kind` gives every reader (digest, worker inbox, tests) the same ability to distinguish
it without that migration cost. Revisit if a second unrelated system-nudge wake needs the same
distinction and the rebuild cost is shared.

### Recovery targets the same worker agent, never a new one

The recovery wakeup's `agentId` is the existing worker's `agents.id` — the same row `tickets.worker_id`
already points at. `tickets.worker_id` is never cleared or reassigned by this change. This is what
keeps the pending-spawn sweep (`spawnPending()`, `supervisor/index.ts:323-358`) out of the picture
entirely: it only ever considers tickets with `worker_id IS NULL`, so a ticket whose worker is
recovering — however many attempts in — is filtered out before `liveWorkerFor()`'s `kind='worker'`
check would even matter. No new agent row, no new binding, nothing for that sweep to race.

### Escalation reuses `decisions.create(..., kind: 'gate_finding', owner: 'weaver')`

Same call shape as the stuck-worker gate (`engine.ts:797-804`), with `correlationKey:
stalled-worker:<agentId>` (distinct from the empty-turns gate's `empty-turns:<agentId>` key, since
these are different findings that can legitimately co-occur). Once raised, the existing "no open
decision on this ticket" clause in `stalledWorkers()` excludes the worker from further detection for
free — no separate "don't re-escalate" bookkeeping needed beyond checking `escalated_at IS NOT NULL`
before creating a second decision within the same sweep tick (belt-and-braces against the correlation
key alone, matching how the empty-turns gate already guards this).

### Evidence-of-progress reset reuses `runProducedEvidence()`

`runProducedEvidence(ctx, runId, ticketId)` (`engine.ts:179-191`) already answers "did this run leave
a ticket comment, document revision, work product, or knowledge revision, or move the ticket's
status" — exactly what "the worker is not actually stuck, it is legitimately still working" means
here too. Reusing it (rather than a second, slightly different notion of progress) keeps the two
escalation paths — three genuinely empty turns, and a stall that recovery couldn't clear — consistent
about what counts as a worker doing something.

### Reset checked against runs since `last_attempt_at`, computed at scan time

On each sweep tick, for every worker `stalledWorkers()` returns that also has a `worker_stall_state`
row: if any `succeeded` run for that agent finished after the row's `last_attempt_at` (or after
`first_detected_at` if no attempt has been made yet) and `runProducedEvidence()` is true for it, the
row is deleted (progress reset) before deciding whether to re-detect the worker as freshly stalled or
leave it alone. This keeps the reset check to the same sweep pass that already computes
`stalledWorkers()`, no separate scheduled job.

### Reads: presenter call sites gain the flag from a single cheap lookup, not a join everywhere

`packages/server/src/presenter.ts` and `packages/presenter/src/views.ts` gain a small helper,
`isWorkerStallState(agentId)` (`SELECT 1 FROM worker_stall_state WHERE agent_id = ?`), called once per
agent/ticket being presented and passed as `stalled`/`workerStalled`. For the workspace push stream,
the two points that create or delete a `worker_stall_state` row push the same kind of status delta the
worker-activity capability's existing throttled push already uses, rather than adding a new stream
event type.

## Risks / Trade-offs

- **A worker that stalls, recovers, stalls again in a different way each time never accumulates past
  one attempt, so it could oscillate indefinitely without ever escalating.** → The reset only fires
  when a run left *observable evidence* of progress, not merely "a run happened" — a worker that keeps
  ending turns cleanly with nothing to show for it keeps accumulating attempts toward the cap
  regardless of how the stalls are phrased.
- **Recovery wake races a wake already in flight for an unrelated reason (a human message, a
  comment).** → `stalledWorkers()` already excludes an agent with a run queued/running or any
  action-path wakeup queued/claimed, so the sweep never selects a worker that already has a live path
  back; `wake.enqueue()`'s own idempotency/coalescing gates are the same ones every other wake source
  already relies on for the remaining race window.
- **The cap is reached quickly for a worker whose task genuinely requires several clean stopping
  points close together (e.g., committing after each of several small tasks).** → Each stop only
  counts toward the cap if the *following* recovery produced no evidence; a worker committing
  meaningful increments keeps resetting to zero. A worker that is truly this granular and still
  produces no evidence between attempts is exactly the case worth surfacing to the weaver.
- **A new table adds one more join/lookup to the presenter's hot read path.** → It's a single indexed
  primary-key lookup (`agent_id`), and the table is expected to be near-empty at any given time (a
  workspace only ever has as many rows as workers currently stalled), so the cost is negligible next
  to the reads already done to build a worker/ticket view.

## Migration Plan

Additive: one new table, no changes to existing tables' shape. Forward-only — no data to migrate. On
deploy, no worker has a `worker_stall_state` row until the first stall is next detected. Rollback is
dropping the table and the sweep's new code path; existing detection-only behavior (the emitted
`worker.stalled` event) is unaffected either way since it is not removed, only supplemented.

## How long a stall can persist, and what the human sees (per acceptance criteria)

With the existing `stalledWorkerTimeoutSec` default (300s, VS-202) and a proposed default recovery cap
of 2: worst case, a worker that keeps stopping cleanly with no evidence of progress is detected,
recovered, re-detected after another ~300s, recovered again, re-detected a third time after another
~300s, and only then escalated — roughly 15 minutes from the original stall to a weaver-owned
`gate_finding` appearing on the ticket, versus the ~29 minutes VS-495 sat unnoticed today with no
floor on how much longer it could have gone. Throughout, the worker's card and its ticket read as
`stalled` (a distinct status, not `active`) from the moment the first stall is detected, so a human
looking at the board during any of those attempts sees that something is off well before the
escalation fires, not just at the end.

## Open Questions

- Exact default for the recovery cap: this design proposes **2**, reasoned above; final value is a
  task-time confirmation against `stalledWorkerTimeoutSec`'s own reasoning comment, not a change to
  the approach or the task breakdown either way.
