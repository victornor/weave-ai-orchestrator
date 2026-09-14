# Tasks — VS-388

## 1. Make the real host runner unreachable from tests

- [x] 1.1 `packages/release/src/index.ts`: export `TEST_GUARD_ENV` (`AC_TEST_GUARD`) and
  `assertHostCommandAllowed(cmd)`, which throws for `systemctl`, `loginctl`, `launchctl`,
  `systemd-run`, `pkill`, `killall` when the marker is set.
- [x] 1.2 `packages/cli/src/daemon.ts`: `realRun` calls `assertHostCommandAllowed(cmd)` before it
  spawns anything.
- [x] 1.3 `packages/cli/src/commands/daemon.ts`: route `drainAndRestart`'s direct
  `spawnSync('systemctl', ['--user', 'restart', …])` through the guarded `realRun`.
- [x] 1.4 `vitest.setup.ts`: after the existing `AC_*` purge, set the guard marker and point
  `XDG_CONFIG_HOME` at a fresh temp dir for the whole core/server suite.

## 2. Isolate every test that can reach the installed unit

- [x] 2.1 `packages/cli/src/commands/daemon-stop.test.ts`: set `XDG_CONFIG_HOME` to a scratch dir
  (not just `XDG_STATE_HOME`); keep the drain-before-stop assertions, and add a case with a fake
  `weave-ai.service` present plus an injected recording runner that proves the CLI takes the systemd
  path without spawning.
- [x] 2.2 Audit every other test that reaches `resolveInstalledUnit()` or a `realRun` default
  (`daemon.test.ts`, `upgrade-runner.test.ts`, `doctor-command.test.ts`, `release/src/index.test.ts`,
  server/core tests) and confirm each either injects a runner or plants its own scratch
  `XDG_CONFIG_HOME`; fix any that does not.

## 3. Prove the guard

- [x] 3.1 `packages/cli/src/daemon.test.ts`: with a fake unit planted in the isolated config dir, a
  test asserts `stopDaemonService()` with the default runner throws the guard error, and that
  `child_process.spawnSync` was never called.

## 4. Verify

- [x] 4.1 `pnpm lint && pnpm typecheck` clean.
- [x] 4.2 Both suites green; paste both suite blocks verbatim in the report.
