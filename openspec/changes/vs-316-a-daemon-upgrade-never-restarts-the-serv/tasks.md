## 0. Rebase onto the landed VS-315 first (review rev 3, 2026-09-13)

- [x] 0.1 Rebase this branch onto `main` at `14c166a2` (VS-315, PR #259) before starting task 1 — not
      deferred to task 8.1 as originally planned, since VS-315 has already merged. Verify `pnpm
      typecheck` is clean post-rebase before proceeding; `UpgradeAnnouncement` now requires
      `ticketsOmitted` and `upgradeOutcome` has a `recorded_completed` case (both already accounted for
      in this plan's design).

## 1. Resolve the installed unit by name, not by assumption

- [x] 1.1 Add `resolveInstalledUnit()` to `packages/release/src/index.ts` (checks the current
      `SERVICE_NAME` path, then falls back to the legacy `agent-conductor.service` path; returns
      `{ name, path }` or `null`). Verify with a unit test over a scratch `XDG_CONFIG_HOME` covering:
      current name present, legacy name present, neither present, both present (current wins).
- [x] 1.2 Change `RestartEnvironment.unitInstalled: boolean` to `unitName: string | null` in
      `packages/release/src/index.ts`; update `planRestart` to build
      `systemctl --user restart ${env.unitName}` (using the resolved name, not the `SERVICE_NAME`
      constant) when `env.unitName` is set. Verify existing `planRestart` unit tests pass with the new
      field, plus a new case asserting the command names the legacy unit when that's what's installed.
- [x] 1.3 Update `packages/server/src/upgrade.ts`'s `launchRunner` to pass
      `unitName: resolveInstalledUnit()?.name ?? null` instead of its local `serviceUnitPath()`/
      `unitInstalled` check; delete that now-unused local function. Verify `pnpm typecheck` and the
      package's existing tests still pass.
- [x] 1.4 Update `packages/cli/src/upgrade-runner.ts`'s `restartCommand()` to pass
      `unitName: resolveInstalledUnit()?.name ?? null` instead of `existsSync(serviceUnitPath())`.
      Leave `packages/cli/src/daemon.ts`'s `serviceUnitPath()` untouched — it stays the "write a new
      unit under the current name" path for `installService()`. Verify with a test that installs a unit
      only under the legacy name and asserts the runner's restart command names it.

## 2. Fail loudly on a restart command that did not work

- [x] 2.1 In `packages/cli/src/upgrade-runner.ts`'s `restartCommand()`, check the `spawnSync` result for
      the systemd/launchd path: throw an `Error` (message including trimmed stderr, capped at 2000
      chars, matching the existing message-truncation convention in `upgrade.ts`'s `fail()`) when
      `r.error` is set or `r.status !== 0`. Verify with a unit test that a non-zero exit throws with the
      stderr in the message.
- [x] 2.2 In `packages/cli/src/upgrade-runner.ts`'s `runUpgradeRunner()`, catch a throw from
      `driveRestart()` (via `io.restart()` failing) and write the upgrade row to `failed` with
      `reason: 'restart_failed'` and the caught message, guarded on `state = 'restarting'` the same way
      `recordVerdict` is. Verify with a test that a throwing `io.restart()` results in a `failed` row
      carrying the message, and that a row already moved to a terminal state by another writer is left
      unchanged (same guard `recordVerdict`'s own tests already exercise).

## 3. Verify the process that answers is the one that was replaced

- [x] 3.1 Add `pid: process.pid` to the `/api/health` response (wherever it is assembled — the module
      `weave_inbox`'s earlier research found at `packages/server/src/routes/daemon.ts`). Update
      `docs/API.md`'s documented response shape. Verify with the route's existing test, extended to
      assert the field.
- [x] 3.2 Add `pid: number | null` to `HealthProbe` in `packages/cli/src/upgrade-runner.ts`; parse it from
      the JSON body in `runUpgradeRunner`'s real `probe()`. Verify existing `upgrade-runner.test.ts`
      fixtures still construct valid `HealthProbe` values (update the `healthy()` test helper).
- [x] 3.3 Add `confirmsReplacement(pid: number): Promise<boolean | null>` to the `RunnerIo` interface.
      Implement it in `runUpgradeRunner`'s real wiring: for the systemd path, query
      `systemctl --user show <unitName> --property=MainPID --value` once; if `pid` matches, `true`
      (fast path); else read `/proc/<pid>/cgroup` and return `true` if it names `<unitName>`, `false` if
      it can be read but doesn't; `null` if `MainPID` itself couldn't be queried or `/proc` can't be
      read. For the no-unit direct-start path, compare against the pid `startDaemon()` itself returned
      (no `/proc` fallback needed — the runner already knows this pid authoritatively). Leave a
      `null`-returning stub noted as best-effort for the launchd path. Verify the `MainPID` parser and
      the cgroup-name check each against **canned strings** (`systemctl show` output; `/proc/.../cgroup`
      contents) — no real `systemctl` or `/proc` read in the test. If one test should exercise a real
      systemd user manager end to end, it uses a uniquely named transient unit via
      `systemd-run --user --unit=weave-test-<random> ...`, asserts against that, and cleans it up —
      **never** a test named `agent-conductor.service` or `weave-ai.service` against the real manager
      (a scratch `XDG_CONFIG_HOME` only changes where this codebase's own lookups search for unit
      *files*; `systemctl --user stop/start/enable/disable <name>` always addresses the one real,
      already-running systemd user manager for whoever runs the test, by that literal name).
- [x] 3.4 Change `driveRestart()` in `packages/cli/src/upgrade-runner.ts` to only accept a probe as
      `completed` when `onTarget(health, target)` **and** `(await io.confirmsReplacement(health.pid)) !==
      false` (i.e. `true` or `null`, either accepted; only an explicit `false` rejects this probe and
      keeps polling). Verify with new `upgrade-runner.test.ts` cases: (a) a probe on target whose
      `confirmsReplacement` returns `true` completes; (b) a probe on target whose `confirmsReplacement`
      returns `false` does not complete and the loop keeps polling until the deadline, then rolls back;
      (c) `confirmsReplacement` returning `null` throughout preserves today's release-match-only behavior
      (existing tests in the file must still pass unmodified where they don't set pids).
- [x] 3.5 Update the `daemon-upgrade/deferred-upgrade` capability's requirements to match — already
      drafted in this change's `specs/daemon-upgrade/deferred-upgrade/spec.md`; no further action beyond
      keeping it in sync if the implementation in 3.1-3.4 diverges from the drafted scenarios.

## 4. Never run two daemons at once on the no-unit fallback

- [x] 4.1 In `packages/cli/src/daemon.ts`'s `stopDaemon()`, after the `SIGKILL` branch, re-check
      `isRunning(pid)` and throw if still running (rather than unconditionally returning `{stopped:
      true}`). Verify with a unit test using a fake `isRunning`/`kill` seam (or a real but unkillable
      child in a test-only harness) asserting the throw.
- [x] 4.2 In `packages/cli/src/upgrade-runner.ts`'s no-unit fallback `run()`, after `stopDaemon()` and
      before `startDaemon()`, probe the configured health URL once; if it answers `ok`, throw rather
      than starting a second daemon. Verify with a test where the fake health check still answers after
      the fake stop, asserting `startDaemon` (or the test's stand-in for it) is never called and the
      upgrade fails identifying a daemon still answering.

## 5. Migrate the legacy unit as part of the restart (captain, 2026-09-13; simplified review rev 2)

- [x] 5.1 Extend `resolveInstalledUnit()` (task 1.1) to report `legacy: boolean`; add the launchd
      counterpart `resolveInstalledLaunchdAgent()` (current `LAUNCHD_LABEL` first, else the inferred
      pre-rename label). Verify with unit tests over a scratch home: current-name-only (`legacy: false`),
      legacy-name-only (`legacy: true`), neither (`null`).
- [x] 5.2 Add a nullable `migrationOutcome: 'migrated' | 'fallback' | 'prepare_failed' | null` column to
      the `upgrades` table — migration `0032_...` post-rebase (`main` ends at `0031_relayed_decision_
      answers.sql` as of review rev 3; re-check the next free number after task 0.1's rebase, since
      another branch may have landed one meanwhile) — and the `Upgrade` type (`packages/shared`). Verify
      with a migration test asserting the column exists and defaults to `null` on a fresh row.
- [x] 5.3 Implement the systemd migration sequence in `packages/cli/src/upgrade-runner.ts`'s restart step,
      gated on `legacy === true`: prepare (write the new unit as the legacy unit file's own content with
      only `Description=` changed — no comparison against `renderServiceUnit`, no skip branch, per review
      rev 2; if a `agent-conductor.service.d/` directory exists, copy — not move — it to
      `weave-ai.service.d/`; `daemon-reload`; `enable`) → cutover (stop legacy, start new; on start
      failure, start legacy back up and continue the upgrade unmigrated, writing `migrationOutcome:
      'fallback'`) → after Decision 3's verify loop confirms healthy-on-target, finalize (`disable` the
      legacy unit, rename its file to `agent-conductor.service.migrated` and its drop-in directory, if
      any, to `agent-conductor.service.d.migrated` — never delete — then `daemon-reload` once more,
      writing `migrationOutcome: 'migrated'`). A prepare-phase failure must not touch the legacy unit or
      its drop-in at all, must fall back to an ordinary Decision 2 restart, and writes `migrationOutcome:
      'prepare_failed'`. Verify with `upgrade-runner.test.ts` cases, all at the `RunnerIo`/host-wiring
      seam with a fake `systemctl` that *records* calls rather than spawning one (design.md, "Testing
      this safely" — never a real `systemctl` call naming either product unit): successful migration end
      to end, asserting the exact call order (write, daemon-reload, enable, stop legacy, start new,
      verify, disable, rename) and `migrationOutcome: 'migrated'`; the new unit's file content matches
      the legacy one verbatim except `Description=`, for both a unit with a custom `Environment=` line
      and a unit missing `TimeoutStopSec` (an older renderer's shape) — both migrate, content preserved;
      a drop-in directory is copied before cutover and renamed (not deleted) at finalize; prepare failure
      falls back to a plain restart untouched with `migrationOutcome: 'prepare_failed'`; cutover-start
      failure falls back to the legacy unit, the upgrade still completes, and `migrationOutcome:
      'fallback'`; both cutover and fallback failing fails the upgrade identifying no daemon came up.
- [x] 5.4 Confirm the existing `HEALTH_DEADLINE_MS` rollback path (Decision 3/4) needs no
      migration-specific branch — once cutover succeeds, a deadline rollback just restarts the now-current
      unit again. Verify with a test: migration cutover succeeds, the new unit never verifies healthy
      within the deadline, and the existing rollback restarts that same (now-current) unit rather than
      reinstating the legacy one.
- [x] 5.5 Mirror 5.3-5.4 for launchd (`bootstrap`/`bootout`/`kickstart` in place of
      `daemon-reload`/`enable`/`stop`+`start`; a `.plist.migrated` rename in place of the unit-file
      rename), marked best-effort per `design.md`'s Non-Goals — a host where the inferred legacy label
      doesn't match simply never triggers migration, same as today (`migrationOutcome` stays `null`).
      Verify with the same seam-level, fake-command tests as 5.3, using the `RunnerIo`/host-wiring
      abstraction rather than a real launchd (no macOS CI here).
- [x] 5.6 Update the `daemon-upgrade/deferred-upgrade` capability to match — already drafted in this
      change's `specs/daemon-upgrade/deferred-upgrade/spec.md` (the migration requirement, its
      drop-in-preservation and verbatim-copy scenarios, and the `migrationOutcome` recording sentence);
      keep it in sync if 5.1-5.5 diverge from the drafted scenarios.

## 6. Resume dispatch if the restart never replaces the serving process (Decision 6, from a comment missed until review rev 2)

- [x] 6.1 In `packages/server/src/upgrade.ts`'s `advance()`, right after `spawnRunner()` succeeds, arm a
      bounded, `unref()`'d watchdog for `RESTART_VERIFY_MS` (the same constant `reconcile()` already
      uses for the boot-time version of this same check; reuse it, do not duplicate the value). On fire,
      guarded on this upgrade's row still being `restarting` (a raw
      `UPDATE ... WHERE id = ? AND state = 'restarting'`, the same guard shape `recordVerdict` uses in
      `packages/cli/src/upgrade-runner.ts`, so a genuine last-second verdict write and this watchdog can
      never both apply): write `state: 'failed', reason: 'restart_unverified'` with a message identifying
      that this process is still serving past the verification window, and call `resumeDispatch()`.
      Clear the timer if the row leaves `restarting` before it fires. Add a `now`/timer seam consistent
      with this module's existing `deps.now` pattern so the test can drive it without a real wait.
      Verify with a `packages/server/src/upgrade.test.ts` case: `spawnRunner` succeeds, the row stays
      `restarting`, simulated time crosses `RESTART_VERIFY_MS` → the row becomes `failed` with
      `restart_unverified` and this process's dispatcher is running again (assert on the fake
      dispatcher's `start()`/`running()` seam already used elsewhere in this file's tests).
- [x] 6.2 Verify the guard against the race with a genuine restart: the row is moved to `completed` (by
      a simulated `recordVerdict`-equivalent write) an instant before the watchdog would fire → the
      watchdog's guarded update is a no-op, `resumeDispatch()` is not called a second time by it, and the
      completed record is unchanged.
      This is the "restart command exits zero but the process is not replaced" acceptance test from the
      ticket's comment: also add the exact-wording case — the restart command itself reports success,
      dispatch is still held in this process, and once the window elapses dispatch is confirmed running
      again *in this same process* and the row is not `completed`.
- [x] 6.3 Update the `daemon-upgrade/deferred-upgrade` capability to match — already drafted in this
      change's `specs/daemon-upgrade/deferred-upgrade/spec.md` ("A pending upgrade holds dispatch without
      interrupting work," the new "restart command succeeds but never replaces the serving process"
      scenario); keep it in sync if 6.1-6.2 diverge from the drafted scenario.

## 7. Reproduce the real incident shape and prove the fix against it

- [x] 7.1 Write a test (in `packages/cli/src/upgrade-runner.test.ts` or a new file alongside it) that
      reproduces the ticket's exact host shape: `resolveInstalledUnit()` reporting the legacy name only,
      `SERVICE_NAME` at `weave-ai.service`, at the `RunnerIo`/fake-`systemctl` seam (never a real
      `systemctl` call, per design.md's "Testing this safely"). Assert the restart migrates to the
      current unit and, given a healthy matching probe, completes — or, given a cutover failure, falls
      back to the legacy unit and still completes; assert it never records `completed` while a probe
      reports the original (unreplaced) pid.
- [x] 7.2 Realize this ticket's "manual end-to-end run" acceptance criterion as a deterministic,
      safe equivalent (per review rev 1 — not a literal run against any real `agent-conductor.service`/
      `weave-ai.service`): at the `RunnerIo`/host-wiring seam, a fake `systemctl` that records every call
      it receives and returns scripted output (including a `MainPID` that matches the fake `probe()`'s
      pid). Drive a full upgrade through `driveRestart`/the migration sequence and assert, in the report,
      the exact recorded call sequence (write unit, `daemon-reload`, `enable`, `stop` legacy, `start` new,
      the verify probe, `disable`, rename-to-`.migrated`) alongside the resulting `RunnerVerdict`. This
      subsumes and is recorded alongside 5.3's and 7.1's own test assertions — the report cites which
      test(s) demonstrate it rather than duplicating a separate manual run.

## 8. Whole-repo checks

- [x] 8.1 Carry `migrationOutcome` into the announcement (review rev 3 — VS-315 shipped without it, so
      this is the only place it reaches captain). In `packages/server/src/upgrade-announce.ts`: add
      `migrationOutcome: Upgrade['migrationOutcome']` to `UpgradeAnnouncement` (`packages/shared`) and
      thread it through `buildAnnouncement`. In `announcementText`, add a short clause when it is
      `'fallback'` or `'prepare_failed'` (silence when `'migrated'` or `null` — a successful or
      not-applicable migration needs no separate mention) naming that the service-unit rename did not
      happen this time. This change's new failure reasons (`restart_failed` with command stderr, the
      Decision 6 `restart_unverified` watchdog case, a migration-cutover failure) already slot into
      `buildAnnouncement`'s existing `reason`/`message`/`outcome` fields — confirmed by reading the
      landed VS-315 code (`upgradeOutcome`/`buildAnnouncement`), not merely assumed. Include
      `ticketsOmitted` in any `UpgradeAnnouncement` test literal this change adds — required by the type
      since VS-315 landed. Verify with a test asserting `announcementText` names a fallback/prepare-failed
      migration and says nothing extra for a migrated or not-applicable one.
- [x] 8.2 Run `pnpm lint`, `pnpm typecheck`, and both `pnpm test` suites (core/server, then
      `packages/ui`); paste both totals verbatim in the report.
- [x] 8.3 Update `docs/API.md` for the `/api/health` field addition and note the restart/verification/
      migration change in this package's relevant doc comments if any reference the old boolean shape.
