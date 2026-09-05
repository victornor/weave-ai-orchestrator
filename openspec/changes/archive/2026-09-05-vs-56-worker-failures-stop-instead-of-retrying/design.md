## Context

See `proposal.md` — Why. The constraints that shape the approach:

- The dispatcher opens the run (`packages/core/src/runs/dispatcher.ts:38-46`) inside the same
  transaction that claims the wakes. It already has the claimed `wakeups` rows in hand, so it has
  the retry payload the engine wrote; it just never reads it.
- `countRetries` (`engine.ts:420`) walks `runs.retry_of_run_id` and caps at 10 hops. It is correct
  code with no data behind it. It also runs *before* the new run row exists in a retry chain sense:
  it counts the chain ending at the run that just failed, so a chain of length *n* means *n*
  automatic attempts have already been made.
- Four call sites put `retryOfRunId` in a wake payload: the engine's backoff retry (`engine.ts:381`)
  and its quota booking (`engine.ts:471`), and the supervisor's boot recovery
  (`supervisor/index.ts:99`) and watchdog retry (`supervisor/index.ts:148`).
- `agents` today carries `status` and a free-text `pause_reason`; the structured failure detail
  exists only on the run row (`error_family`, `error_code`) and inside the decision's `target` JSON.
  Every list surface reads agents, not runs and not decisions.
- `workers.resume` (`workers/index.ts:270`) sets `status = 'active'` and clears `pause_reason`. It
  enqueues nothing, so the dispatcher has no wake to claim and the worker never takes a turn. The
  HTTP route, the CLI verb and the `useWorkerAction` hook already exist and all reach this dead end.
- `parkForHuman` (`engine.ts:440`) books the quota retry itself, unconditionally, with idempotency
  key `quota_retry:<runId>`.

## Goals / Non-Goals

**Goals:**
- One place decides whether a failure is retried automatically, and the ladder is countable from
  stored data rather than from a payload nobody reads.
- A paused worker is self-describing: every surface can render the reason from the worker it already
  fetched, with no join to runs or decisions.
- Resume is one idempotent operation that all five surfaces call, and it is what relaunch degrades
  to for a worker that is merely waiting on a human.

**Non-Goals:**
- Changing how the runtime adapters classify an error into a family. `provider_quota` means what it
  means today; only the engine's reaction changes.
- Changing the backoff timings, the auth single-retry, or the watchdog and boot-recovery ladders.
- Any budget or plan-limit alerting that is not a reaction to a failed run — `usage-plan-limits`
  keeps its own snapshot poll and is untouched.
- Automatic resume on any signal other than a reset time the human explicitly chose.

## Decisions

### Record the retry link in the dispatcher, at claim time

The claim transaction reads the queued wakes and inserts the run. It takes `retryOfRunId` from the
claimed wakes' payloads — the most recent wake that carries one — and writes it to
`runs.retry_of_run_id` in the same insert. This is one column in one insert and it fixes every
producer at once, including the two supervisor paths, without any of them changing.

*Alternative considered — have each producer write the column after the run starts.* Rejected: four
call sites, a write-after-insert race with the engine's own read, and it leaves `retry_of_run_id`
writable from outside the transaction that owns the run's identity.

*Alternative considered — count retries from the wake payloads instead of the column.* Rejected: the
wakes are marked `completed`/`failed` and coalesced, so the payload chain is lossy, and `runs` is
the table `docs/PLAN.md` §7.1 already names as the ladder's record.

Guard: `countRetries` keeps its 10-hop cap, so a cycle in the data cannot spin.

### Take `provider_quota` out of `RETRYABLE`

`RETRYABLE` becomes `['transient_upstream']`. The finalize branch that parks a non-retryable worker
already handles everything else; a quota failure now falls into it on its first occurrence, with
`countRetries` reading zero, which is exactly right.

This deviates from `docs/PLAN.md` §7.2 step 8, which lists `provider_quota` in the retried families,
so it gets **ADR 0010** and a corrected line in the PLAN. The rationale for the ADR: a quota is not
transient in the way an upstream 503 is — the runtime has already told us the window is exhausted,
so the ladder can only fail three more times at increasing cost and delay before reaching the same
card. Retrying it is guaranteed-waste, and the direction on this ticket is to spend nothing without
the human's word.

### Structured pause detail as one JSON column on `agents`

A new additive migration `0011_agent_pause_detail.sql` adds `agents.pause_detail_json` (nullable).
It holds `{ family, code, message, resetAt, runId }`, all optional. `pause_reason` stays as it is —
it remains the one-line human string, and it is what a worker paused by a human carries alone.

*Alternative considered — four scalar columns.* Rejected: the shape is read as a unit by every
consumer and never queried by a single field; one nullable JSON column matches how `delivery_json`,
`usage_json` and `target_json` are already used in this schema.

*Alternative considered — no column; surfaces join the open `retry_approval` decision, whose
`target` already carries family and code.* Rejected: the board, Team and `conductor worker list`
each fetch agents in one call, and the decision is withdrawn when the worker recovers while the
reason should outlive it until the next turn. It also does not cover a worker parked when the card
could not be raised — the exact VS-49 failure this repo has already been bitten by.

`Agent` in `packages/shared/src/types.ts` gains `pauseDetail: AgentPauseDetail | null`. The workers
routes return the agent row as-is, so no route changes; `packages/render`'s `workerToCard` gains a
`pauseReason` field derived from the detail with the free-text `pause_reason` as fallback, and the
web and CLI both render that one derived string. That keeps the wording in one place, as
`statusLabel` already is.

### The reset attempt becomes an option, not a booking

`parkForHuman` stops enqueueing `quota_retry:<runId>`. When `parseResetTime` yields a time, the card
gains `{ key: 'retry_at_reset', label: 'Retry when the limit resets (<time> UTC)' }` and recommends
it; the reset time also goes into `pause_detail_json.resetAt`. `applyRetryApproval` gains a
`retry_at_reset` branch that resumes the worker with `notBefore` set to the stored reset time,
idempotency key `retry_at_reset:<decisionId>`. When no reset time is known the card keeps today's
`retry_1h` option unchanged.

Existing `retry`, `retry_1h`, `runtime:<id>` and `cancel` answers keep their behavior and
additionally clear `pause_detail_json`.

### One `resume`, and relaunch degrades to it

`workers.resume` becomes: clear `status`, `pause_reason` and `pause_detail_json`; enqueue a
`source: 'system'` wake with reason `resumed`; emit `worker.status`; and, when the worker has a
ticket that is `blocked`, transition it back the way `applyRetryApproval` already does
(`in_progress` when an execution run is held, else `todo`) and wake the conductor with
`worker.resumed`. It is idempotent: resuming an already-active worker enqueues nothing new, because
the wake carries idempotency key `resume:<agentId>:<turnEpoch>`.

`workers.relaunch` checks first: if the worker is `paused` with a `pause_detail_json`, it delegates
to `resume` rather than bumping `briefRevision` and re-rendering the home. That satisfies
"`ac_worker_relaunch` on a quota-paused worker behaves as resume" without giving the conductor a
second tool to learn. A relaunch of a worker paused by a human, or of an `error` worker, is
unchanged.

*Alternative considered — a separate `ac_worker_resume` tool for the conductor.* Rejected as scope
the ticket does not ask for; the acceptance criterion is specifically that relaunch behaves as
resume.

### The conductor's context

`buildTurnPrompt`'s conductor "Open work" line (`prompts/index.ts:264-268`) already prints
`— <name> (<status>)`. For a worker whose status is `paused` with a detail it prints
`— <name> (paused: <family> — <message>; the human owns the resume)`. That is where the conductor
reads a stuck worker today, so it is where the distinction has to live. No digest event type
changes: the `retry_approval` card is already a `decision.created` the digest forwards.

## Risks / Trade-offs

- **A transient failure that used to spin forever now parks after three attempts, so a long upstream
  outage produces cards it previously produced none of.** → That is the point of the ticket, and the
  card supersedes rather than accumulating (one open card per worker). The 30 s / 2 min / 10 min
  ladder is unchanged, so the outage window covered before parking is unchanged too.
- **A quota failure no longer retries at all, so a runtime that misclassifies a one-off 429 as
  `provider_quota` now stops work that would previously have recovered by itself.** → The card is
  raised immediately with "Retry now" available, and classification is explicitly out of scope; if a
  runtime proves noisy, the fix belongs in that adapter.
- **`retry_of_run_id` starts being written on a live database, so `countRetries` becomes non-zero
  for the first time and workers that had been spinning park on their next failure.** → Intended.
  There is no backfill: existing runs keep a null link, so an in-flight chain restarts its count
  from the first attempt after the upgrade, which under-counts rather than over-counts.
- **`pause_detail_json` is a second place a pause reason lives, and the two can disagree.** → Only
  `parkForHuman` writes the detail, and it writes both fields together; every clear path
  (`resume`, the four `applyRetryApproval` answers, a successful turn's finalize) clears both.
  Surfaces derive one string from the pair with the detail winning.
- **Resume enqueuing a wake makes it a spend-causing action from five surfaces.** → It is a human
  action on a worker that is already paused waiting for exactly that, it is idempotent per turn
  epoch, and it is recorded as activity like `pause` and `relaunch` already are.

## Migration Plan

1. `0011_agent_pause_detail.sql` adds one nullable column; it applies on the daemon's normal startup
   migrate, so a plain `conductor daemon upgrade` is sufficient. No backfill, no data rewrite, no
   table rebuild.
2. Workers already paused when the upgrade lands keep their free-text `pause_reason` and have a null
   detail; every surface falls back to that text (spec: "A worker with no recorded reason").
3. A `quota_retry:<runId>` wake booked by the previous version and still queued fires as before —
   it is an ordinary retry wake and nothing rejects it. It is a one-off tail, not a state the new
   code can produce.
4. Rollback is the standard release rollback: the added column is nullable and unread by the
   previous version, so an older release runs against the migrated database unchanged.
