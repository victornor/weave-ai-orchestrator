## Why

Two failures compounded when the host restarted on 2026-09-13. The daemon came back with no notice to any weaver (only an upgrade posts one), and the two turns the stop cut off were recorded as `exit_143`/`exit_1` worker failures and parked with human `retry_approval` cards, so captain had to resume VS-334 and VS-338 by hand. The engine already means to call a shutdown cut `interrupted`; the runtime adapters attach an `error` to a non-zero exit, which wins over that check, and nothing re-queues a turn that finalized as interrupted during shutdown anyway.

## What Changes

- **Shutdown wins over the runtime's own error.** The daemon marks a shutdown (or a restart drain) synchronously, before any child process can be signaled, and any turn still active when that mark is set is finalized as `interrupted` whatever its exit code or runtime-reported error — a genuine failure outside shutdown is classified exactly as today.
- **An interrupted turn resumes by itself.** A turn interrupted by shutdown leaves its wakes `queued` (not `failed`) and its worker `active`, so the next daemon's dispatcher picks it up with no human card. The same signal is set by `POST /api/daemon/drain`, before it cancels, and cleared by `undrain`. The deferred upgrade's drain-and-restart is covered too: the upgrade that cut this ticket's own turn off (19:22:12Z) reported `runs: {drained: 4, interrupted: 4, resumed: 1}` while two of those turns were still finalized as `failed` and parked.
- **The upgrade announcement's counts agree with the records.** The `daemon.upgraded` payload's `interrupted` and `resumed` counts are read from the turns the restart actually recorded interrupted and their queued wakes, not a snapshot of what was running before the restart, so they cannot disagree with what finalize and boot recovery did.
- **A restart that is not an upgrade is announced.** The daemon records a durable lifecycle (last boot, last clean shutdown, failed start attempts) and, on boot, gives each workspace's weaver one wake and posts one short "back up" line on the chat: when it went down and came back, whether the shutdown was clean or a crash, which workers' turns were interrupted and are resuming, and any start attempt that failed (for example the bind error).
- **An upgrade restart is not announced twice.** A boot that came back on a different release than the previous boot is an upgrade; it keeps its existing `daemon.upgraded` wake and posts no second notice.
- **The weaver instructions say what to do with the wake**, in `templates/weaver.AGENTS.md.tmpl` and `skills/weave-ai-weaver/SKILL.md`, one short paragraph like the upgrade wake.

## Capabilities

### New Capabilities
- `daemon-restart/restart-announcement`: the durable boot/shutdown lifecycle record, and the one wake plus one chat line a non-upgrade restart produces, including clean-vs-crash, failed starts, and the turns it interrupted.

### Modified Capabilities
- `daemon-shutdown/graceful-drain`: a turn cut off by shutdown — a plain stop, an HTTP drain, or a deferred upgrade's restart — is recorded `interrupted` regardless of exit code or runtime error and is re-queued to resume, rather than parked or failed.
- `daemon-upgrade/upgrade-announcement`: the payload's `interrupted` and `resumed` counts are read from the recorded interruptions and their queued wakes.

## Impact

- `packages/core/src/runs/active.ts` (`RunRuntimeState.shuttingDown`), `dispatcher.ts` (`beginShutdown`, cleared by `start()`), `engine.ts` (`finalize` precedence, wake re-queue, agent status).
- `packages/core/src/api.ts` (`Dispatcher` interface).
- `packages/server/src/daemon.ts` (observe/mark boot, record shutdown, record failed start, announce restart), `routes/daemon.ts` (mark the drain), `upgrade.ts`/`upgrade-announce.ts` (counts from records), and a new `restart-notice.ts`.
- `packages/shared/src/types.ts` (`RestartNotice` payload type).
- `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md`.
- No schema migration: the daemon's existing `meta` table holds the lifecycle keys; no new route.
- Tests: `packages/core/src/runs/engine.test.ts` (143-with-error and exit-1 during shutdown), `packages/core/src/runs/dispatcher.*`, a new `packages/server/test/restart-notice.test.ts`, the upgrade-announcement count tests, and existing fakes updated for the interface.
