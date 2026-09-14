# Design — VS-388

## Decision 1: the guard lives where the host command is actually spawned

The failure is that `realRun` — the single function every `RunCommand` default forwards to — will
happily spawn `systemctl` against whatever unit `resolveInstalledUnit()` found. The strongest place
to stop that is the spawn itself, not each caller: a caller that forgets to inject a fake cannot
bypass it.

`realRun` (packages/cli/src/daemon.ts) is the only spawn of a *host-lifecycle* command behind the
`RunCommand` seam. `@weave-ai/release` is the leaf both the CLI and the server import, so the guard
predicate lives there (`assertHostCommandAllowed`) and is exported for reuse and for tests. The one
direct host-lifecycle spawn outside the seam — `drainAndRestart`'s
`spawnSync('systemctl', ['--user', 'restart', …])` in `commands/daemon.ts` — is routed through
`realRun` so it is guarded too.

## Decision 2: an environment marker, not `NODE_ENV`/`VITEST`

The vitest global setup sets `AC_TEST_GUARD=1`. It must be set **after** the setup's existing
`AC_*` purge, or that purge would delete it. A dedicated marker is deliberate:

- The production CLI never sets it, so a real `weave daemon stop` on the host is unaffected.
- It is visible in any test process regardless of runner (`vitest`, `vitest run <file>`,
  `pnpm test`), because `setupFiles` always run.
- `NODE_ENV`/`VITEST` are ambient states other tooling may set for unrelated reasons; the guard
  should only fire when this suite is running.

## Decision 3: which commands are guarded

`systemctl`, `loginctl`, `launchctl`, `systemd-run`, `pkill`, `killall`. The first four are the
host-lifecycle mechanisms the CLI and server use; the last two are the exact class of kill the
VS-376 incident came from and there is no legitimate reason for a test to call them. Everything else
(`git`, `pnpm`, `node`, `tail`) stays spawnable — the suite needs it, and it cannot stop a service.

The guard throws a message naming the command and the two ways out (inject a fake runner, or
isolate `XDG_CONFIG_HOME`), so the failure is actionable rather than mysterious.

## Decision 4: a throwaway `XDG_CONFIG_HOME` for the whole suite

The guard stops the *spawn*, but a test can still resolve the host's unit and then behave
differently (that is literally how the ticket was found). The setup also points `XDG_CONFIG_HOME` at
a fresh temp dir for every test file, so `resolveInstalledUnit()` never sees the host. Tests that
need their own config dir already set one in `beforeEach` and restore the saved value — which is now
the throwaway dir, so their isolation composes instead of fighting.

## Decision 5: how the guard is proven

Two tests, both observable:

- **`daemon.test.ts`** plants a `weave-ai.service` in the isolated config dir, then calls
  `stopDaemonService()` with the default runner. The guard must throw. `node:child_process` is
  mocked in that file so a `spawnSync` that somehow got through is recorded, and the test asserts
  the recording is empty — the "grep for no systemctl spawn" the ticket asks for.
- **`daemon-stop.test.ts`** keeps its drain-before-stop coverage, with `XDG_CONFIG_HOME` isolated to
  a scratch dir so the systemd path is never reached. It also gains a case with a fake unit present
  and an injected recording runner, proving the CLI takes the systemd path against the *unit it
  resolved* without ever spawning anything.

The suite never runs `systemctl` against the host, never starts or stops the live daemon, and never
touches port 7433.

## Audit (Decision 3's "cover them the same way")

| Site | Host command | Reachable from tests? | Covered by |
|---|---|---|---|
| `cli/src/daemon.ts` `realRun` | `systemctl`, `loginctl` (via `RunCommand`) | yes, as a default | `assertHostCommandAllowed` inside `realRun` |
| `cli/src/commands/daemon.ts` `drainAndRestart` | `systemctl --user restart` | yes (if a unit resolves) | routed through `realRun` |
| `cli/src/upgrade-runner.ts` | `systemctl`/`launchctl` via `io.run` | no — `restartCommand(config, io)` always receives an injected `io` | `RunCommand` seam (VS-316) |
| `server/src/upgrade.ts` `onPath` | `systemd-run --version` (a probe, spawns nothing destructive) | no — `launchRunner` is only called through the injectable `spawnRunner` dep | audited, left unguarded |
| `server/src/upgrade.ts` `launchRunner` | spawns the **new release's CLI**, not `systemctl` | no — injected `spawnRunner` in tests | audited, left unguarded |
| `cli/src/daemon.ts` `stopDaemon` | `process.kill(pid)` from the CLI's own pid file | yes, but only a pid the test wrote to its isolated `XDG_STATE_HOME` | unchanged; not a name/pattern kill |
