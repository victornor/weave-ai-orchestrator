## Why

The merge-slot stall alert (`mergeChecksAlarmSec`, default 20 min) fires whenever a slot holder's checks
are unresolved for that long. FanStack's `dotnet-tests` job legitimately takes 25–37 min, so on
2026-11-20 the alert fired on four healthy landings (VS-981, VS-983 twice, VS-985), each time reading
"6/7 passed" as if something were wrong. The alert text also invited a re-run of a job 25 minutes into
a 30-minute suite. On VS-981 the alert was answered by moving the ticket out of `merging` into
`blocked`, which clears `merge_queued_at`/`merge_started_at`: the worker was stranded out of the queue
until a human put it back. An alert that always fires carries no information, and waiting resolves
itself where losing the queue place does not.

## What Changes

- Judge each pending check on its own instead of the slot's age: a **running** check is stuck only
  once it has outlived GitHub's own job limit (360 min); a **queued / never-started** check is stuck
  after the existing `mergeChecksAlarmSec` wait (20 min default). No pending detail at all (no run,
  everything skipped or cancelled) keeps the slot-age rule. Self-tuning is not used: a multiple of past
  runs would need run history the forge call does not return, and GitHub's own timeout is exact.
- The rollup entries now carry the run `status` and real `startedAt` (the zero time is dropped).
- The alarm text names the offending check and why (not started / past the job limit), no longer says
  the run is merely "in progress", and states the queue place is kept and that the job should not be
  re-run or the ticket re-statused because of it.
- The alarm remains comment + weaver wake only; a test proves it never changes ticket status or
  queue timestamps. `mergeChecksAlarmSec` is kept (now the queued-grace and re-alert cadence).

## Capabilities

### New Capabilities
- `worker-supervision/merge-checks-alarm`: when the supervisor alarms about a merge-slot holder's checks, and what the alarm may and may not do.

### Modified Capabilities

## Impact

`packages/core/src/supervisor/` (new `merge-stall.ts`, `index.ts`), `packages/core/src/forge/gh.ts`,
`packages/plugin-sdk/src/index.ts` (`ForgeCheck` gains optional fields), tests. No schema, config or API change.
