# Design — VS-376

## Decision 1: `Restart=always`, and why it does not fight a deliberate stop

The unit's job is "keep the daemon up". `Restart=on-failure` treats a clean exit — the incident's
`process.exit(0)` after a drained shutdown — as success, so the daemon stayed down. `Restart=always`
restarts on any exit. systemd still honours an explicit `systemctl --user stop` as a deliberate stop
and does not restart afterwards, so the operator commands keep working unchanged:

- `weave daemon stop` becomes `systemctl --user stop <unit>` when a unit is installed (Decision 3),
  which is exactly the "deliberate stop" systemd respects.
- The guarded upgrade path (`upgrade-runner.ts`) restarts through `systemctl --user restart <unit>`
  (`planRestart`), which is a stop+start of the same unit, not a bare process death, so `always`
  does not produce a restart loop.

`RestartSec=3` already bounds the retry cadence.

## Decision 2: normalise the installed unit in place, do not re-render it

The unit on a host may carry fields a re-render would drop: a custom `Environment=` line, a drop-in
directory, a `TimeoutStopSec` adjusted by hand. So the fix is a targeted, pure content transform,
`withRestartAlways`, that only replaces an existing `Restart=` line whose value is not `always`.
A unit with no `Restart=` line at all is left alone — every unit `renderServiceUnit` wrote has one,
and the failure this ticket fixes is specifically the `on-failure` value.

`ensureUnitRestartAlways(run)` resolves the installed unit (current or pre-rename), applies the
transform, writes only when it changed and then best-effort `systemctl --user daemon-reload`. It is
called from two places:

- `restartCommand` (the upgrade runner) before it plans/executes the restart, so an upgrade repairs
  the unit it is about to restart;
- `weave doctor`, as a check that reports what it found and rewrote.

## Decision 3: start/stop through systemd when a unit exists

`daemon start` currently spawns a detached `node bin.js`. When a unit is installed the daemon is a
service, so a second start must not create a process the service does not know about. The command
resolves the installed unit (`resolveInstalledUnit`, which prefers the pre-rename name while a
migration is in flight) and runs `systemctl --user start <unit>`; with no unit it keeps the
detached-spawn path unchanged. `daemon stop` mirrors this: drain over HTTP first (unchanged), then
`systemctl --user stop <unit>` when a unit exists, else the existing `stopDaemon()`.

`drainAndRestart` (used by `daemon restart|upgrade|rollback`) already preferred `systemctl restart`;
it now resolves the unit the same way instead of only testing the current-name file, so a pre-rename
host is restarted through the unit that actually exists rather than by killing a pid systemd would
restart.

`daemon status` reads the unit's `MainPID` and warns when the pid the CLI started is not the one the
unit owns — the "running from a terminal, outside `weave-ai.service`" shape the incident left behind.

## Decision 4: the scratch-daemon helper's contract

`scripts/scratch-daemon.sh start|stop` keeps its state in one scratch directory (default
`${TMPDIR:-/tmp}/weave-scratch-daemon`, override with `--dir` or `AC_SCRATCH_DIR`):

- `start` writes `<dir>/config/daemon.yaml` (`auth.loopbackTrusted: true`), launches
  `node packages/server/dist/bin.js --config-dir <dir>/config --listen 127.0.0.1:<port>`, and records
  the pid in `<dir>/pid`. Port defaults to `0` (the daemon picks and reports one), so two workers
  never collide.
- `stop` reads `<dir>/pid`, reads that pid's command line with `ps -o args= -p <pid>`, and **refuses**
  unless it contains `<dir>/config`. Only then does it `SIGTERM` the pid and escalate to `SIGKILL`
  after a bounded wait. A pid file that names anything else is left alone — the whole point is that a
  stale or wrong pid file cannot kill the live daemon.

The command-line check is what makes a recorded pid safe where a name/pattern match is not: the live
daemon's own command line contains the release path, never a scratch config dir.

## Decision 5: testing seams

Every new `systemctl` call goes through the `RunCommand` seam already used by `upgrade-runner.ts`
(now defined in `daemon.ts`, which the runner imports). Tests inject a fake and never touch the real
user manager, matching VS-316's rule. File-level behaviour (which unit resolves, what is rewritten)
is tested against a scratch `XDG_CONFIG_HOME`, as `upgrade-runner.test.ts` already does. The helper
script is tested by running `stop` against a live `sleep` pid file whose command line does not name
the scratch dir, and asserting it refuses and the process survives.
