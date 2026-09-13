## Why

Every upgrade on this host has recorded itself `completed` while the daemon it was meant to replace kept
running untouched: the restart targets a systemd unit name that does not exist here, the runner discards
that failure, and a health probe that happens to answer on the target release is accepted as proof even
when it comes from a stray second process rather than the one being replaced. The next upgrade fails the
same way until this lands (VS-316, from incident `01M2BGG9Z81T6BMNWTJNTTCT47`).

## What Changes

- The restart plan targets whichever systemd unit is actually installed on the host — the legacy
  `agent-conductor.service` name or the current `weave-ai.service` one — instead of always the current
  name, by resolving the installed unit once and reusing that name, rather than each restart path
  guessing independently (today `packages/server/src/upgrade.ts` and `packages/cli/src/daemon.ts` each
  carry their own copy of the lookup, and only one of the two has the legacy fallback).
- A restart command that exits non-zero, or fails to start, fails the upgrade with its stderr in the
  record's message, instead of being treated as a successful restart request.
- An upgrade is recorded `completed` only once the daemon that answers healthy on the target release is
  confirmed to be the one systemd (or, in the no-unit fallback, the runner itself) currently manages —
  not merely "some daemon answered on target" — so a stray process that happens to run the new release
  can never pass verification in place of the service.
- Before the runner ever starts a daemon directly (the fallback for a host with no installed unit), it
  stops the one it believes is running and confirms nothing still answers health before starting the
  replacement, so it can no longer run two daemons at once.
- **A host still running the legacy `agent-conductor.service` unit (or, on macOS, the pre-rename launchd
  label) migrates to the current name automatically, as part of the first upgrade that finds it** —
  product behaviour every install gets, not a fix scoped to this host (captain, 2026-09-13). Migration
  never leaves two units running or none, and a migration-cutover failure falls back to the still-present
  legacy unit rather than failing the whole upgrade (see `design.md`, Decision 4, for the exact sequence
  and why it's safe). The new unit is the legacy unit's own file content, verbatim, with only
  `Description=` changed — so a hand edit or an older renderer's shape is preserved rather than silently
  blocking migration forever (review rev 2).
- The upgrade row gains `migrationOutcome` recording whether this upgrade migrated the unit, fell back to
  the legacy one, or never got past prepare — so the weaver can tell captain whether the rename happened
  without reading logs (review rev 2).
- **Dispatch no longer stays held forever in a process whose restart silently never replaced it.** The
  2026-09-12 incident's most damaging effect wasn't the stuck upgrade record — it was that every
  workspace stopped dispatching for 1h40m, because nothing ever told the still-serving process to resume.
  A bounded watchdog now does, using the same window boot-time reconciliation already uses.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `daemon-upgrade/deferred-upgrade`: strengthens "The restart is performed from outside the daemon
  process and is verified" — the restart targets the actually-installed unit, a failed restart command
  fails the upgrade with its output, and "completed" requires proof that the process being replaced was
  actually replaced, not just that a daemon answered healthy on target. Adds the unit-migration behavior
  as part of the same restart step.

## Impact

- `packages/release/src/index.ts`: `RestartEnvironment`/`planRestart` change from a boolean
  `unitInstalled` to the resolved unit name; new `resolveInstalledUnit()` replaces the two duplicated
  `serviceUnitPath()` lookups in `packages/server/src/upgrade.ts` and `packages/cli/src/daemon.ts`.
- `packages/cli/src/upgrade-runner.ts`: `restartCommand()` checks the restart command's exit status;
  `driveRestart()` gains a way to confirm the answering daemon is the one that was actually replaced;
  the no-unit fallback verifies the previous daemon is gone before starting a new one.
- `packages/server/src/routes/daemon.ts` (or wherever `/api/health` is assembled): the health response
  gains the responding process's pid, needed to tell the service-managed daemon apart from a stray one.
- `packages/cli/src/daemon.ts`: gains the launchd-side legacy lookup alongside the systemd one; its
  existing `serviceUnitPath()`/`installService()` are unchanged in meaning.
- `packages/db` (a new migration) and `packages/shared` (the `Upgrade` type): a nullable
  `migrationOutcome` column on `upgrades`.
- `packages/server/src/upgrade.ts`: `advance()` arms a watchdog after `spawnRunner()` succeeds, so
  dispatch resumes in this process if the restart never replaces it (Decision 6).
- Tests: `packages/cli/src/upgrade-runner.test.ts`, `packages/release` restart-planning tests, a new
  fixture reproducing the legacy-unit-name host shape (now also exercising migration's cutover and its
  fallback-on-failure), and a new `packages/server/src/upgrade.test.ts` case for the dispatch-resume
  watchdog.
- **Overlaps with VS-315** (PR #259, **merged** as `14c166a2`): both edit
  `packages/server/src/upgrade.ts`. This change rebases onto it first (task 0.1) and slots its new
  failure reasons and `migrationOutcome` into VS-315's announcement contract itself (task 8.1), rather
  than leaving that to a follow-up. See `design.md`'s Risks / Trade-offs.
