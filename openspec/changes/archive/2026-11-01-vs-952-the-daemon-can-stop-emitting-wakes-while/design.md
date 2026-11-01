## Context

The supervisor (`packages/core/src/supervisor/index.ts`) runs one `tick()` per workspace every 15 s, guarded by a `ticking` flag. Each step is wrapped in `.catch()` or `try/catch`, so a step that throws is already survivable. A step whose promise never settles is not. `ticking` stays `true`, and every later tick returns at line 1547 without running anything:

- the digest
- routines
- liveness and stall scans
- spawning
- merge pumping

The process, the HTTP listeners and the 1 s dispatcher all keep running. That is exactly the "healthy but inert" daemon the ticket described. The 2026-10-31 incident was not this (see `investigation`), but the hazard is real.

The same incident exposed the real gap: once the weaver reviews a human-owned approval, nothing re-raises it.

- `reviewReminderScan` wakes only the weaver, and only for `unseen` cards.
- `staleReviewSweep` only surfaces cards when `yolo(t)` is true.
- Channels push a card exactly once, at `decision.created` (`ChannelManager.pushDecisionCard`, `PushDispatcher`).

## Goals / Non-Goals

**Goals**
- No single supervisor step can stop the others.
- Anyone can tell idle-waiting-on-human from stalled in one unauthenticated read, with no dependency on a wake.
- A human-owned card waiting on the human is re-announced on a slow, bounded cadence.
- An actually stalled daemon under systemd restarts itself.

**Non-Goals**
- An event-loop-blocked process: a synchronous infinite loop. No in-process timer can fire then. systemd's `WatchdogSec=` with `sd_notify` would catch it, but Node has no native notify socket. This is documented as a known limit, not built.
- Changing how wakes are created or dispatched, the digest's relevance rules, or the weaver's own review reminders.
- Reminders for weaver-owned decisions. The weaver already has `reviewReminderScan` and digests.

## Decisions

### D1. A step runner with a timeout and an in-flight guard
`runStep(name, fn)` replaces each `await x().catch(log)` in `tick()`:

- It races `fn()` against a 2-min timer (`SUPERVISOR_STEP_TIMEOUT_MS`).
- On rejection it logs `supervisor step failed` with `{ step, err }`, as today.
- On timeout it logs `supervisor step timed out` with `{ step, timeoutMs }` and returns, so the tick continues.
- The pending promise stays in an `inFlight` map. Later ticks see the entry and skip that step, logging once per stuck episode, so a step is never re-entered while its previous call is still running. A re-entered merge pump or promotion advance could double-act.
- When the promise settles, the entry is removed and `supervisor step settled after timeout` is logged with `{ step, durationMs }`.

The synchronous steps (`livenessScan`, `conductorDigest`, `fireDue`, …) keep their `try/catch`. They cannot hang without blocking the event loop, which is out of scope.

*Alternative considered:* a whole-tick timeout that resets `ticking`. Rejected because it lets the next tick re-enter the very step that hung.

### D2. Tick bookkeeping and a pure state function
The supervisor keeps `startedAt`, `lastTickStartedAt` and `lastTickFinishedAt`, and the `inFlight` map holds each step's start time. `health()` adds cheap DB reads:

- `activeRuns`: `runs` rows with `status='running'`.
- `queuedWakes`: `wakeups` rows that are `queued` and due, or `claimed`.
- `lastWakeAt`: `ORDER BY rowid DESC LIMIT 1` on `wakeups` for the workspace. That is O(1), not a `MAX(created_at)` scan.
- open human-owned decisions, with the oldest age on the reminder clock (D4).

`supervisorState(input)` is a pure function in `packages/shared` (`SUPERVISOR_STATES` in `enums.ts`), applying the fixed order in the spec:

| state | holds when | threshold |
|---|---|---|
| `stalled` | no tick finished for 10 min, or a step in flight for 30 min | 10 min is five step timeouts, so two newly hung steps in one tick (4 min) do not trip it |
| `starting` | no tick has finished yet | |
| `active` | a run is running or a wake is queued or claimed | |
| `idle_waiting_on_human` | an open human-owned decision exists | |
| `idle` | none of the above | |

### D3. `/api/health` and `ok`
`routes/daemon.ts` adds `supervisor: ws.services.supervisor.health()` to each workspace entry. Top-level `ok = !workspaces.some(w => w.supervisor.state === 'stalled')`.

- `?strict=1` turns `ok:false` into HTTP 503, for uptime monitors that only read status codes.
- Plain requests stay 200, so the upgrade runner's `health?.ok && onTarget(...)` keeps working. A freshly restarted daemon is `starting`, never `stalled`, so an upgrade is not marked failed by its first read.
- No titles or names are exposed, because the route is `auth: 'open'`.

### D4. Reminder clock, stages and persistence
- **Clock start:** for `plan_approval`, `merge_approval` and `action_approval` it is `weaver_reviewed_at`; the card is skipped while `weaver_review_status='unseen'`. For every other human-owned kind it is `created_at`.
- **Stage:** `stage = floor((age − after) / every)` for `age ≥ after`: 0 at 4 h, 1 at 28 h, 2 at 52 h, and so on. The defaults are `after` = 4 h and `every` = 24 h. They are workspace `defaults.humanReminderAfterSec` and `defaults.humanReminderEverySec`, next to `weaverDigestIntervalSec`.
- **Persistence:** migration `decisions.human_reminder_key TEXT`, holding `"<clockStartIso>#<stage>"`. The scan reminds when its computed key differs from the stored one, then stores the new key in the same transaction as the activity row and the event. That makes it restart-safe and idempotent. A re-review moves the clock start, which changes the key prefix, so stages count from the new start. A column beats a `meta` key per decision because it disappears with the row and needs no sweep.
- **Cadence:** the liveness cadence (60 s). A reminder at 4 h ± 1 min is fine.

### D5. Delivery
New event type `decision.reminder` (`packages/shared/src/events.ts`). It is not added to `DIGEST_EVENT_TYPES`, because the weaver cannot answer a human's card.

- `ChannelManager.onEvent` calls `pushDecisionReminder(id)`. It re-reads the decision and returns if it is no longer open and human-owned. Otherwise it posts one text line to the primary thread, for example: `Still waiting on you · 4h — VS-951 merge: "<title>". Answer with /d <id> <option>, or open Needs you.` Never a second card (VS-223).
- `PushDispatcher` accepts `decision.reminder` alongside `decision.created`. The title is prefixed `Still waiting:`.
- Webhooks forward it like any event.

### D6. Stall exit lives in the server
`core` must not call `process.exit`. `daemon.ts` starts a 60 s `unref`'d interval after the workspaces load:

- It reads every `ws.services.supervisor.health()` and tracks, per workspace, when `stalled` began.
- Once a stall reaches `supervisor.stallExitSec` (new `DaemonConfigSchema` key, default 600, 0 disables):
  - with `INVOCATION_ID` set, it logs `fatal` and calls `stop('supervisor_stalled')`. A 30 s timer then forces `process.exit(1)` if the shutdown hangs, and the shutdown completing exits 1 as well.
  - without `INVOCATION_ID`, it logs one `error` per stall episode.
- An `exit`/`env` seam on the start options keeps it testable.

The live unit and `weave daemon install-service` both carry `Restart=always` (`packages/cli/src/daemon.ts:268`, enforced since VS-376), so systemd restarts on any exit. `docs/OPERATIONS.md` §3 still shows `Restart=on-failure`; that is corrected.

## Risks / Trade-offs

- **A timed-out step keeps running in the background.** Its side effects can land after later steps of that tick. This is acceptable: steps are already independent passes over DB state, and the in-flight guard prevents overlap with itself.
- **A permanently pending step is skipped forever** until it settles. After 30 min it turns the state `stalled`, which surfaces it and, under systemd, restarts the process. That is the remedy that clears a leaked promise.
- **Reminders add chat messages.** The volume is bounded: at most one per open human card per 24 h after the first 4 h. `humanReminderAfterSec: 0` turns them off.
- **An exit cuts live turns.** Boot recovery marks them interrupted and re-wakes them (an upgrade loses no work the same way). The exit only happens after 20 min with no finished tick.

## Migration Plan

One additive migration (`decisions.human_reminder_key`, nullable). Existing open cards start with a null key. On first deploy, a card already past 4 h is reminded once at its current stage, which is the intent. Rollback leaves the column unused.

## Open Questions

None. The weaver confirmed the scope on 2026-11-01.
