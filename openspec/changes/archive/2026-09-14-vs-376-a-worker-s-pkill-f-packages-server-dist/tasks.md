# Tasks — VS-376

## 1. Restart the unit after any unexpected exit

- [x] 1.1 `packages/cli/src/daemon.ts`: `renderServiceUnit` emits `Restart=always` (keep
  `RestartSec=3`). Test in `packages/cli/src/daemon.test.ts`: the rendered unit contains
  `Restart=always` and not `Restart=on-failure`.
- [x] 1.2 `packages/cli/src/daemon.ts`: add the pure `withRestartAlways(content)` (replace an
  existing non-`always` `Restart=` line only) and `ensureUnitRestartAlways(run?)`, which resolves the
  installed unit, rewrites it in place when stale, and best-effort `systemctl --user daemon-reload`.
  Tests with a scratch `XDG_CONFIG_HOME`: an `on-failure` unit is rewritten and reloaded; an
  `always` unit and a nonexistent unit are left untouched.
- [x] 1.3 `packages/cli/src/upgrade-runner.ts`: `restartCommand` calls `ensureUnitRestartAlways`
  before planning, so an upgrade repairs an installed `on-failure` unit. Test in
  `packages/cli/src/upgrade-runner.test.ts`: a current-name `on-failure` unit is rewritten when
  `restartCommand` runs, with the reload issued through the injected runner.
- [x] 1.4 `packages/cli/src/commands/doctor.ts`: a `systemd unit` check that rewrites a stale unit and
  reports what it did.

## 2. `daemon start`/`stop`/`status` follow the installed unit

- [x] 2.1 `packages/cli/src/daemon.ts`: `startDaemonService(run?, platform?)` resolves the installed
  unit and runs `systemctl --user start <unit>`; `packages/cli/src/commands/daemon.ts`'s `start`
  action uses it when a unit is installed, falling back to the existing detached spawn otherwise.
  Test with an injected runner: a planted unit file makes it call
  `systemctl --user start weave-ai.service`; no unit makes it return null.
- [x] 2.2 `packages/cli/src/daemon.ts`: `stopInstalledUnit(unit, run?)` +
  `packages/cli/src/commands/daemon.ts`'s `stop` action runs `systemctl --user stop <unit>` after the
  drain when a unit is installed, else the existing `stopDaemon()`. Test with an injected runner.
- [x] 2.3 `packages/cli/src/commands/daemon.ts`: `drainAndRestart` resolves the installed unit
  (`resolveInstalledUnit`) instead of only checking the current-name file.
- [x] 2.4 `packages/cli/src/commands/daemon.ts`: `daemon status` reads the unit's `MainPID` and warns
  when a running daemon is not the one the unit owns.

## 3. Workers cannot kill the live daemon by accident

- [x] 3.1 Add `scripts/scratch-daemon.sh` (`start|stop`, `--dir`, `--port`): temp config dir, loopback
  port, pid recorded in the scratch dir, stop refuses a pid whose command line does not name the
  scratch config dir.
- [x] 3.2 Test the helper's stop: a pid file naming a live `sleep` (command line without the scratch
  dir) is refused and the process survives; a pid whose command line names the scratch dir is stopped.
- [x] 3.3 `CLAUDE.md` "Developing Weave AI inside Weave AI": never `pkill`/`killall`/kill by name or
  pattern (the live daemon runs the same `bin.js`), point at `scripts/scratch-daemon.sh`, and name
  both live-install paths (`~/.local/share/weave/current` and the older
  `~/.local/share/agent-conductor/current`).

## 4. Verify

- [x] 4.1 `pnpm lint && pnpm typecheck` clean.
- [x] 4.2 Both suites green, and both suite blocks pasted verbatim in the report.
