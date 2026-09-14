# A test must never stop the host's live daemon

Tracker change for [VS-388](weave://tickets/VS-388). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

On 2026-09-14 the VS-367 worker ran `pnpm test` on a checkout that included VS-376 (#315), and
`packages/cli/src/commands/daemon-stop.test.ts` failed: it expected `not running` and got
`stopped systemctl --user stop weave-ai.service`.

That was a real invocation against the host's user systemd, not a mock. It only stopped nothing
because the installed `weave-ai.service` happened to be inactive — the live daemon had been started
by hand outside the unit after the VS-376 incident. Once the unit runs the live daemon again, **any
worker's `pnpm test` stops production.**

Two faults compound:

- `daemon-stop.test.ts` isolated `XDG_STATE_HOME` only. `resolveInstalledUnit()` reads
  `$XDG_CONFIG_HOME/systemd/user/weave-ai.service` (falling back to `~/.config/...`), so on a
  developer host it found the live unit.
- The real runner is a *default argument*, not an injected dependency the test controls:
  `stopDaemonService`, `startDaemonService`, `ensureUnitRestartAlways` and `systemdMainPid` all
  default their `run` to `realRun`, a real `spawnSync`. A test that accidentally reaches one of
  them reaches the host.

## What changes

- **The real runner refuses to run host-lifecycle commands under a test.** A vitest global setup
  sets a marker (`AC_TEST_GUARD`); `realRun` throws before spawning `systemctl`, `loginctl`,
  `launchctl`, `systemd-run`, `pkill` or `killall` when it is set. A test that would otherwise
  reach the host fails loudly instead.
- **The whole suite gets a throwaway `XDG_CONFIG_HOME`.** The setup points it at a fresh temp dir, so
  `resolveInstalledUnit()` can never see the host's unit even if a test forgets to isolate.
- **Every test that reaches an installed-unit lookup is isolated.** `daemon-stop.test.ts` and the
  other reaching tests run against a scratch config dir with an injected runner, matching VS-316's
  existing seam.
- **The audit covers the direct spawns.** `drainAndRestart`'s bare `spawnSync('systemctl', …)` is
  routed through the guarded `realRun` too; every other host-command spawn is either already behind
  the `RunCommand`/`HostIo` seam or unreachable from tests.

## Out of scope

- Any product behaviour change: `weave daemon stop/start/restart` keep doing exactly what they did on
  a real host. Only the test environment gains the guard.
- Guarding non-lifecycle commands (`git`, `pnpm`, `node`, `tail`), which are safe and needed by
  tests.
