## 1. Supervisor tick resilience

- [x] 1.1 Add `runStep(name, fn)` to `supervisor/index.ts`: 2-min timeout, an `inFlight` map that skips a still-pending step on later ticks, and logs for failed, timed-out and settled-after-timeout steps. Route every awaited tick step through it.
- [x] 1.2 Record `startedAt`, `lastTickStartedAt` and `lastTickFinishedAt` and expose `supervisor.health()` (type in `core/api.ts`).
- [x] 1.3 Add `SUPERVISOR_STATES` and the pure `supervisorState()` to `packages/shared`, with a unit test for every state and the order between them.
- [x] 1.4 Supervisor tests. (a) The digest step throws once; the same tick still runs later steps, and the next tick enqueues the digest wake. (b) A step that never settles; the tick finishes, the next tick skips only that step while the digest and routines still run, `health()` lists it in flight, and when it settles it runs again.

## 2. Health report

- [ ] 2.1 `/api/health`: add a per-workspace `supervisor` block (no titles), `ok` false only when a workspace is `stalled`, and HTTP 503 for `?strict=1` when not ok. Server route test.
- [ ] 2.2 `weave daemon status`: add supervisor state, last-tick age, last-wake age and open-human-decision count columns to the workspace table; `--json` carries the block unchanged. CLI test.
- [ ] 2.3 Document the new fields in `docs/API.md`.

## 3. Stall exit

- [ ] 3.1 Add `supervisor.stallExitSec` (default 600, 0 disables) to `DaemonConfigSchema`.
- [ ] 3.2 Add the stall watchdog in `server/src/daemon.ts`: a 60 s unref'd interval that tracks when each workspace's stall began. Under `INVOCATION_ID`, log fatal, `stop('supervisor_stalled')`, exit 1, forced after 30 s; otherwise log one error per episode. Add an exit/env seam, and tests for the systemd and non-systemd cases plus idle-is-not-stalled.

## 4. Reminders for unanswered human cards

- [x] 4.1 Add a migration for `decisions.human_reminder_key`; add the `decision.reminder` event type; add `defaults.humanReminderAfterSec` (14400) and `defaults.humanReminderEverySec` (86400) to the workspace config.
- [x] 4.2 Add `humanReminderScan()` on the liveness cadence: the clock starts at `weaver_reviewed_at` for review-carrying kinds (unseen cards skipped) and at `created_at` otherwise. Compare the stage key, then store the key, write the `decision.reminded` activity row and emit the event in one transaction. Tests: reviewed merge card at 4 h, unseen card, human question, disabled, answered, repeat scan, stage 1 at 28 h, re-review resetting the clock.
- [ ] 4.3 Make `ChannelManager` post the text follow-up on `decision.reminder` (re-read the decision; never a card) and make `PushDispatcher` send a push. Tests assert the message text contains the identifier, kind, age and `/d <id>`, and that nothing is posted for a closed card.

## 5. Docs and verification

- [ ] 5.1 `docs/OPERATIONS.md`: add "What a healthy daemon looks like from outside" next to the unit. Cover the supervisor states, that silence is normal while everything waits on a human, the one command that tells idle from stalled (`curl … /api/health | jq`), the SQL for operators with DB access, the stall exit and its systemd dependency, and the event-loop-block limit. Fix the documented unit to `Restart=always`. Add a troubleshooting entry, "No wakes for hours", that links to it.
- [ ] 5.2 `docs/CONFIGURATION.md`: add `defaults.humanReminderAfterSec`, `defaults.humanReminderEverySec` and `supervisor.stallExitSec`.
- [ ] 5.3 Run `pnpm lint`, `pnpm typecheck` and both test suites (per-directory with `--maxWorkers=1` if the turn's memory limit requires it). Paste both suite blocks into the PR, with the corrected premise at the top of the PR description.
