## 1. Host primitives in `packages/release`

- [x] 1.1 Add `readUnitRuntimeState(unit, run)` (one `systemctl --user show <unit> --property=ActiveState,SubState,NRestarts,MainPID`, parsed to `{ activeState, subState, nRestarts, mainPid }`, sentinel `null` when unreadable) and verify with unit tests over fake `RunCommand` output in `packages/release/src/index.test.ts`
- [x] 1.2 Add `parseListenPort(url)`, `findPortHolder(port, run)` (`ss -ltnpH 'sport = :<port>'` then `lsof -nP -iTCP:<port> -sTCP:LISTEN`, `null` when neither yields a holder) and `classifyRestart({ unit, holder, trackedPid, trackedVerified })`, and verify the parser/decision with unit tests: holder-is-unit, verified tracked detached daemon, and unidentifiable holder
- [x] 1.3 Move the guarded host runner into `packages/release` as `realRunCommand` (keeping `AC_TEST_GUARD` via `assertHostCommandAllowed`), have `packages/cli/src/daemon.ts`'s `realRun` re-export it, and verify `pnpm --filter @weave-ai/release test` plus the existing `packages/cli/src/daemon.test.ts` still pass

## 2. Detached-daemon reconciliation in the CLI

- [x] 2.1 In `packages/cli/src/daemon.ts`, add `reconcileDetachedDaemon()` as a seam-injected function: act only when a unit is installed, the pid file names a live process that is not the unit's `MainPID`, its command line is this product's server `bin.js`, and it holds the configured listen address; then `SIGTERM` that pid, wait bounded for exit and the address to free, and remove the stale pid file; verify with fake `RunCommand`/kill/cmdline/port seams in `packages/cli/src/daemon.test.ts`, including the reused-pid and unverified-cmdline no-signal cases
- [x] 2.2 Wire `reconcileDetachedDaemon()` into `weave daemon stop`, `restart` and `upgrade` (and `drainAndRestart`) so each signals the detached pid and continues with the unit instead of returning after only asking the unit to stop; verify in `packages/cli/src/upgrade-commands.test.ts` and `packages/cli/src/commands/daemon-stop.test.ts`
- [x] 2.3 Give `weave daemon start` a detached-daemon branch: when a unit is installed and a detached daemon is tracked, report it and hand over to the unit instead of printing "already running"; verify in `packages/cli/src/commands/daemon.test.ts`

## 3. Local CLI: preflight, drain rule and postflight

- [x] 3.1 In `packages/cli/src/daemon.ts`, add the listener-reachability helper (probe `daemon.json`'s `loopbackUrl`, else its port) and the preflight/`readUnitRuntimeState` wrappers over the guarded runner, verified by unit tests with fake `RunCommand`
- [x] 3.2 In `packages/cli/src/commands/daemon.ts`, make `drainAndRestart` take the target `{ release, sha }`: run the preflight and refuse an unidentifiable out-of-service holder, refuse a drain that fails while the listen address is reachable, and only report success when the unit is `active (running)` without a restart loop, the answering process is the unit's own (MainPID or cgroup), and it reports the target release; verify in `packages/cli/src/upgrade-commands.test.ts`: preflight refusal, crash-loop failure, sha-mismatch failure, different-process failure, success-on-target, and drain-skip-only-when-nothing-listens
- [x] 3.3 Run the preflight at the start of `daemon upgrade` before `buildRelease` so a refused restart does not build, and pass the built release as the target to `drainAndRestart`; pass `currentLink()` for `restart` and `previousLink()` for `rollback`; verify each command's target is asserted in `packages/cli/src/upgrade-commands.test.ts`
- [x] 3.4 Fix the `weave doctor` "local daemon process" check so a unit-managed daemon (pid file absent, unit `MainPID` live and owning the address) reads healthy and a detached daemon coexisting with an installed unit warns with the handover remedy; verify in `packages/cli/src/doctor-command.test.ts`
- [x] 3.5 Add the `weave doctor` out-of-service and restart-loop checks, gated to the confirmed local daemon host on Linux, each with its remedy; verify in `packages/cli/src/doctor-command.test.ts` that both are reported on a fake host and neither on a healthy one

## 4. Deferred self-upgrade

- [x] 4.1 In `packages/cli/src/upgrade-runner.ts`, preflight in `restartCommand().run()` before signalling the unit — refusing a detached daemon or unidentifiable holder without signalling any process — and make the probe crash-loop-aware through `HostIo` so a climbing `NRestarts` or stuck `activating`/`failed` fails the verdict fast; verify in `packages/cli/src/upgrade-runner.test.ts` with a fake host (no real systemctl; `AC_TEST_GUARD` on) that the detached case records a failure and sends no kill
- [x] 4.2 In `packages/server/src/upgrade.ts`, add the defaulted `restartPreflight` seam and run it in `advance()` after the idle wait and before `building`; on failure record `fail(id, 'restart_failed', message)` and `resumeDispatch()` without switching `current`; verify in `packages/server/test/upgrade.test.ts` that `current` is unchanged, the record is failed, and no process was signalled
- [x] 4.3 In `packages/server/src/upgrade.ts`, add the defaulted `restartCause` seam and append its result to the pre-`restarting` `abandoned` message in `reconcile()`, falling back to the existing wording when it returns `null`; verify in `packages/server/test/upgrade.test.ts` that a restart-looping unit and an out-of-service daemon each appear in the recorded message

## 5. Integration and gates

- [x] 5.1 Run `openspec validate vs-407-weave-daemon-upgrade-reported-restarted --strict` and verify it is clean
- [x] 5.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, pasting both suite blocks verbatim in the ticket report (core/server and UI separately)
