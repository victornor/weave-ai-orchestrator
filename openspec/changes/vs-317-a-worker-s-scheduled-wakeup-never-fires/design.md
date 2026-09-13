## Context

See `proposal.md` — Why. The pieces this design builds on, as they exist today:

- The wake queue already accepts a delayed wake: `EnqueueInput.notBefore`
  (`packages/core/src/api.ts:300`), stored as `wakeups.not_before` (`packages/core/src/wake/index.ts:30`).
  The decisions service already uses it (`packages/core/src/decisions/service.ts:316`).
- The dispatcher honours `notBefore` in all three places that matter: the candidate query
  (`packages/core/src/runs/dispatcher.ts:137`), the eligibility check for an isolated daemon
  (`:77`), and the claim query (`:87`). So "a delayed wake fires when due" is existing, tested
  behaviour — this change does not add the timing mechanism, it adds the producer.
- Each turn is one runtime CLI process that exits with the turn. The Claude binary contains the
  harness tool `ScheduleWakeup` (and `CronCreate` / `CronList` / `CronDelete`), verified by reading
  the installed `claude` 2.1.270 binary's strings — no CLI was launched. Those tools schedule inside
  the process and cannot outlive it.
- Tool registration is one registry (`packages/server/src/tools.ts`) filtered by agent kind through
  `toolNamesFor` (`:895`), with the worker-only set in `packages/shared/src/tools.ts`. A new tool
  must be named in that set or `packages/shared/src/tools.test.ts` fails the prose that mentions it.
- `RuntimeAdapter.permission.deniedTools` already flows to `--disallowedTools`
  (`packages/core/src/runs/engine.ts:401`, `packages/runtimes/claude/src/args.ts:105`).
- The stalled-worker sweep is one query, `stalledWorkers()` in
  `packages/core/src/supervisor/index.ts:420`, whose "no queued/claimed wakeup" clause is what makes
  a worker with any queued wake look like it still has an action path.

## Goals / Non-Goals

**Goals:**
- A worker can arrange, from inside a turn, for the daemon to start its next turn later.
- The mechanism is the daemon's own wake queue, so it survives the turn, a daemon restart, and the
  runtime process dying.
- A scheduled wait is distinguishable from a genuine stall, at every surface an operator looks at.

**Non-Goals:**
- Changing the dispatcher's `notBefore` handling, which already works.
- Recurring schedules (routines already serve the weaver) or a general cron engine.
- Watching background processes on disk; the worker decides when to check, this only makes the
  request reliable.
- Letting the weaver schedule itself with this tool — routines are its mechanism.

## Decisions

### A dedicated `self_scheduled` wake source, not `timer`

Add `self_scheduled` to `WAKE_SOURCES`. It is the identity the replace rule, the pending-wake reader,
and the supervisor's grace logic all key on, and it makes the wake self-describing when the worker
reads it back through `weave_inbox`. `timer` is the conductor heartbeat and PLAN §7.1 is explicit
that workers have no timers; repurposing it would erase that distinction and make "clear the worker's
pending self-wake" impossible to express as one predicate.

### Scheduling lives on the wake service, and bypasses coalescing

`WakeService` gains:

- `scheduleSelfWake(agentId, { reason, delayMs, requestedBy })` — validates the delay against the
  shared bounds, cancels the agent's outstanding queued `self_scheduled` wake (clearing its
  idempotency key so the stable key can be reused), emits `wake.queued`, records activity, and
  inserts a new `queued` wake due at `now + delayMs`.
- `pendingSelfWake(agentId)` — the agent's queued `self_scheduled` wake, or null.

It inserts directly rather than going through `enqueue`. `enqueue`'s gate 3 coalesces a new wake into
any queued wake that is due now (`wake/index.ts:80`), which would fold a scheduled wake into a normal
one and dispatch it immediately — the exact failure this ticket removes. A scheduled wake must be
its own queued row; the direct insert is a handful of lines duplicating gate 4, which is the honest
cost of not adding a "do not coalesce" flag to the one funnel every other producer uses.

`requestedBy` is the calling worker's actor, so an isolated daemon's dispatch gate treats a self-wake
the same way it treats a retry — it does not dispatch it in isolation. That is the consistent choice:
isolation means a human asked for this run, and an agent's own timer is not a human request.

### The tool: `weave_schedule_wakeup`, worker-only, exactly one of delay or instant

Input `{ reason, delayMinutes?, at? }`; exactly one of `delayMinutes` / `at`; `at` an ISO instant
that must be in the future. The handler converts `at` to a delay and passes a single `delayMs` to the
service, so the bounds have one enforcement point. Unknown keys are stripped by the Zod object, so
supplying an `agentId` cannot redirect the wake — the tool has no agent parameter and always uses
`ctx.claims.agentId`.

Bounds are fixed constants in a new `packages/shared/src/self-wake.ts`: minimum one minute (below
that, the worker should just continue its turn), maximum 24 hours (past that, a self-wake has more in
common with a scheduled task, which this is not). The same file exports the stalled grace margin.

Alternative considered: accepting only `delayMinutes`, with the tool computing everything. Rejected
because the ticket asks for an absolute time too, and "check at the window reset" is easier to state
as an instant.

### Denying the runtime's scheduler tools, declared by the adapter

`RuntimeAdapter` gains an optional `workerDeniedTools?: string[]`. The Claude adapter declares
`['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete']` (names read from the installed binary);
adapters with no such tools declare nothing. The engine unions the calling runtime's list into
`permission.deniedTools` only when `agent.kind === 'worker'`
(`engine.ts:397`), leaving the weaver's turn untouched and the role's own denial unchanged.

This keeps the runtime-specific names on the adapter that owns them instead of a runtime id map in
`core`, which the boundary guard would tolerate but which would rot the moment an adapter is added.
The mechanism (`--disallowedTools`) already exists and is tested; this only feeds it.

### Supervisor: a self-wake is an action path only until it is clearly overdue

`stalledWorkers()`'s wakeup clause becomes: a claimed wake always counts; a queued wake counts unless
it is a `self_scheduled` wake whose `not_before` is at or before `now - grace`. The grace margin is
long enough that the dispatcher (a 1 s tick) would certainly have claimed a due wake, and short
enough that a stalled worker is reported promptly. This is the only query change; the sweep's
behaviour — emit `worker.stalled`, never resume — is unchanged.

### Visibility: compute on read, ship the worker, not a new column

The pending self-wake is a query over `wakeups`, not new state, so it is computed at each read site:
`workerView` (`inspect.ts`), the two worker tools, and `GET /workers` + `GET /workers/:id`. The HTTP
routes already attach a computed field this way (`interactiveSession`), and `WorkerListItem` in
`packages/ui/src/api/hooks.ts` is the typed place to add `scheduledWake`. `WorkerCard`/`WorkerRow`
render the time and reason the way they already render a pause reason.

## Risks / Trade-offs

- **[Risk]** A worker schedules a wake, then the daemon is down at the due time. → **Mitigation**:
  the wake stays `queued` with its `notBefore` in the past, so it is claimed on the first dispatch
  tick after boot, exactly as a delayed retry is today. No recovery path is needed.
- **[Risk]** The direct insert skips `enqueue`'s lifecycle gates (workspace inactive, agent
  paused/retired). → **Mitigation**: those states also stop the dispatcher from claiming, so the wake
  simply waits; the tool is only reachable from a live worker turn. The replace step cancels a stale
  self-wake even when the agent's state has since changed.
- **[Risk]** `--disallowedTools` with a name a given CLI version does not know. → **Mitigation**:
  the names are declared per adapter and verified against the installed binary; a denied tool the CLI
  does not know is inert. The instruction warning in the worker skill is the backstop for a runtime
  that cannot be denied cleanly.
- **[Trade-off]** Denying `ScheduleWakeup`/`Cron*` removes a capability a worker might legitimately
  want mid-turn (a short in-turn loop). Accepted: an in-turn wait can continue the turn; the failure
  being fixed is a schedule that outlives the turn and silently never fires.

## Migration Plan

1. Ship the enum value, constants and service methods; no existing wake row or caller is affected.
2. Ship the tool and instructions; workers adopt it on their next turn.
3. Ship the supervisor clause change; a worker whose only queued wake is an overdue self-wake flips
   from "not stalled" to "stalled", which is the intended correction.
4. No data migration. Rollback leaves `self_scheduled` rows behind, which then read as ordinary
   queued wakes — the pre-change behaviour.

## Open Questions

None. The grace margin's exact value is a constant chosen in implementation (one minute, matching the
dispatcher's claim latency with a wide margin) and does not change the specs.
