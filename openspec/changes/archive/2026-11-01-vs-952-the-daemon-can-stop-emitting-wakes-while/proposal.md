## Why

The ticket reported that the daemon stopped emitting wakes for 20h42m on 2026-10-31 while systemd showed it healthy. **The daemon journal shows that is not what happened** (ticket document `investigation`):

- The supervisor tick ran every 15–35 s for the whole window. It logged in 1243 of 1242 minutes, and the retention sweep ran at 23:50Z.
- Not one error or stack was logged.
- `routines.fireDue()` runs inside the same `tick()` as the digest. The routine firing at 01:15Z therefore proves the tick was alive; it does not show that one timer survived while another died.
- The digest is driven by events and ignores the weaver's own activity. The weaver's last turn ended `needs_decision` at 04:33:30Z. After that nothing happened that the digest reports, so it correctly stayed silent.

The workspace was idle because every open item was waiting on captain. Two gaps made that look like an outage:

1. **A human-owned approval that the weaver has reviewed re-notifies nobody, ever.** VS-951, the fix for an alert storm, waited a day one tap from landing. Only the weaver is ever re-woken, and only for cards it has not reviewed (`reviewReminderScan`).
2. **Nothing distinguishes "idle, waiting on a human" from "stalled".** An active unit, `NRestarts=0` and `/api/health` → `ok: true` say the same thing in both cases. Telling them apart took a journal dig, and the first conclusion drawn was the wrong one.

The investigation also found a latent hazard that *would* produce the outage the ticket described. `tick()` is guarded by `if (ticking) return`, so one step whose promise never settles would freeze every later tick while the process and `/api/health` still look healthy. It did not happen here. It is reachable through any forge or git call with no timeout.

## What Changes

- **Reminders for unanswered human cards.** An open human-owned decision left unanswered past `defaults.humanReminderAfterSec` (default 4 h), and then every `defaults.humanReminderEverySec` (default 24 h), emits a `decision.reminder` event. The Telegram/chat channel posts it as a text follow-up on the primary thread, saying how to answer. Web push sends a notification. The clock for a card that needs the weaver's review starts when the weaver marks it reviewed; until then the card is the weaver's, not the human's. Each stage fires once, and the record survives restarts.
- **A tick that cannot be wedged.** Each awaited supervisor step runs under a per-step timeout (2 min). A step that times out keeps running but no longer holds the tick. While it is still pending, that step alone is skipped on later ticks, so it is never run twice concurrently. A step that throws is still caught and logged, and later ticks still run it. Regression tests cover both shapes.
- **A supervisor block in `/api/health`.** Each workspace reports:
  - `state`: one of `starting`, `active`, `idle_waiting_on_human`, `idle`, `stalled`;
  - `lastTickStartedAt`, `lastTickFinishedAt`;
  - steps in flight, with their age;
  - `lastWakeAt`;
  - active runs and queued wakes;
  - the count and oldest age of open human-owned decisions (no titles, because the route is unauthenticated).
  
  The top-level `ok` is `false` only when some workspace is `stalled`. `?strict=1` returns HTTP 503 in that case, for external monitors. Nothing in this depends on a wake being created.
- **Exit on a stall, under systemd only.** When a workspace has been `stalled` for `supervisor.stallExitSec` (daemon.yaml, default 600 s, 0 disables) and the process runs under systemd (`INVOCATION_ID` set), the daemon logs a fatal line and exits non-zero. The unit `weave daemon install-service` writes carries `Restart=always`, as does the live unit, so it comes back and boot recovery resumes interrupted turns. Outside systemd the daemon only reports the stall, because exiting would leave it down.
- **`weave daemon status`** prints each workspace's supervisor state.
- **Docs: "What a healthy daemon looks like from outside"** in `docs/OPERATIONS.md`, next to the unit. It says plainly that silence is normal while everything waits on a human, and names the one command that tells the two cases apart. It also corrects the documented unit, which says `Restart=on-failure` where the generator writes `Restart=always`. The new route fields and config keys go in `docs/API.md` and `docs/CONFIGURATION.md`.

## Capabilities

### New Capabilities
- `human-decisions/unanswered-reminders`: re-notifying the human about a card that waits on them.
- `daemon-health/supervisor-liveness`: a supervisor tick that no single step can stop, and the exit on a stall.
- `daemon-health/health-report`: the supervisor block in `/api/health`, and the rule that `ok` is false only for a stall.

### Modified Capabilities

## Impact

- `packages/core/src/supervisor/index.ts` (step runner, tick state, `health()`, reminder scan).
- `packages/shared` (event type `decision.reminder`, supervisor states, config keys).
- `packages/db` (migration: `decisions.human_reminder_key`).
- `packages/server`: `routes/daemon.ts`, `channels.ts`, `pushDispatcher.ts`, the stall watchdog in `daemon.ts`.
- `packages/cli` (`daemon status`).
- Docs: `docs/OPERATIONS.md`, `docs/API.md`, `docs/CONFIGURATION.md`.

No change to how wakes are created or dispatched.
