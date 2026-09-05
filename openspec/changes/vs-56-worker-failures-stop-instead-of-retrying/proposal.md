## Why

A worker whose runtime fails with a retryable error is supposed to be retried three times and then
parked for the human. It never is. `countRetries` (`packages/core/src/runs/engine.ts:420`) measures
the ladder by walking `runs.retry_of_run_id`, but nothing writes that column: the engine and the
supervisor put `retryOfRunId` in the *wake payload*
(`engine.ts:381`, `engine.ts:471`, `supervisor/index.ts:99`, `supervisor/index.ts:148`) and the
dispatcher inserts the run row without it (`dispatcher.ts:38-46`). The count is therefore always
zero, `attempt < maxAttempts` always holds, and a `transient_upstream` or `provider_quota` failure
re-queues forever. Nothing ever reaches the branch VS-49 repaired.

For a usage limit that is worse than a bug: the workspace burns a turn every 30 seconds, then every
2 minutes, then every 10 minutes, against a quota that has already run out, and the human is never
told why the work stopped — there is no card, and no surface names the reason. The workspace owner's
direction is that a failure like this should stop rather than spin: surface the reason, pause, and
let the human resume once they have resolved the limit.

## What Changes

- **The retry link is recorded.** When the dispatcher claims a wake carrying `retryOfRunId`, the run
  it opens stores that link, so the ladder is countable and a transient failure is retried at most
  three times (30 s / 2 min / 10 min) before the worker is parked. The timings are unchanged; what
  changes is that the ladder now ends.
- **A usage limit leaves the ladder entirely.** `provider_quota` no longer counts as retryable: the
  first quota failure pauses the worker, blocks the ticket and raises the retry card, with no
  automatic attempt at all. **BREAKING** against the ladder documented in `docs/PLAN.md` §7.2 step 8,
  which lists `provider_quota` alongside `transient_upstream`; recorded as an ADR.
- **No spend without an answer.** The card no longer books an attempt on its own. When the runtime
  reported a reset time the card says so and offers "retry when the limit resets" as an option
  alongside retry now, switch runtime and cancel; if the human answers neither, the worker stays
  paused and costs nothing.
- **The reason is stored structurally and shown everywhere.** A paused worker carries the failure
  family, the runtime's error code, the runtime's own message and the reset time when there is one.
  The retry card, the ticket's status line, the board card, the Team page's worker row, the worker
  page and `conductor worker list|show` all name the family and the message.
- **Resume is first-class.** Resuming a paused worker wakes it — today it only flips a column, so
  nothing happens — and continues the same ticket, worktree, branch and session. It is reachable
  from the card, the ticket page, the Team page, the worker page and `conductor worker resume`, and
  it tells the conductor the worker resumed. Relaunching a paused worker resumes it rather than
  treating it as stuck.
- **The conductor reads a paused worker as a blocker, not as something to restart.** Its turn
  context names the family and the message and says the human owns the next move.
- Tests cover the retry link, ladder exhaustion after three attempts, quota pausing on the first
  failure with the reason surfaced, resume waking the worker, and the reset-time option booking the
  attempt only when it is chosen.

## Capabilities

### New Capabilities
- `run-recovery/retry-ladder`: which failures the system retries by itself, how many times and how
  far apart, how the attempts on one piece of work are linked so the ladder can be counted, and that
  a usage limit is never retried automatically.
- `run-recovery/paused-worker-visibility`: what a paused worker records about why it stopped, where
  that reason is shown, and how a human or the conductor resumes it.

### Modified Capabilities
- `run-recovery/stuck-worker-parking`: parking is no longer only for a spent ladder — a usage limit
  parks on the first failure; the card carries the failure family, the runtime's message and the
  reset time; and the attempt the card used to book by itself becomes an option the human chooses.

## Impact

- `packages/core/src/runs/dispatcher.ts` — record `retry_of_run_id` from the claimed wakes.
- `packages/core/src/runs/engine.ts` — `RETRYABLE` loses `provider_quota`; `parkForHuman` writes the
  structured pause, offers the reset option and books nothing on its own.
- `packages/core/src/workers/index.ts` — `resume` wakes the worker and notifies the conductor;
  `relaunch` on a paused worker resumes it.
- `packages/core/src/decisions/service.ts` — the new `retry_at_reset` answer; existing answers clear
  the structured pause.
- `packages/core/src/prompts/index.ts` — the conductor's open-work line names a paused worker's
  reason.
- `packages/db/src/migrations/` — one additive migration adding the structured pause to `agents`.
- `packages/shared/src/types.ts` — the `Agent` wire shape gains the pause detail.
- `packages/render/src/entities.ts` — `workerToCard` carries the pause reason.
- `packages/ui/` — `WorkerCard`, `TicketCard`/`TicketPage`, `Team`, `WorkerPage`: show the reason,
  offer Resume.
- `packages/cli/src/commands/worker.ts` — `list` and `show` print the reason.
- `docs/adr/0010-*.md` and `docs/PLAN.md` §7.2 — the deviation from the documented ladder.
- Deployment: the migration applies on the daemon's normal startup migrate. Workers already paused
  keep their free-text reason and gain no structured detail; the surfaces fall back to it.
