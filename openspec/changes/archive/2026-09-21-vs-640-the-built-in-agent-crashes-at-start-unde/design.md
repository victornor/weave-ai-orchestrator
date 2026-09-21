## Context

See `proposal.md` — Why. The relevant current state, read from the code:

- `packages/runtimes/weave/src/child.ts` `childBaseEnv(base)` keeps only `PATH`, `HOME`, `LANG` and
  `TMPDIR`; this is the built-in agent's deliberate child-env allowlist, and it must stay narrow.
- `packages/runtimes/weave/src/adapter.ts:254` spawns the child with `env: childBaseEnv(base)` and
  passes `input.containment` to `spawnLines`.
- `packages/runtime-sdk/src/process.ts:38` `spawnLines` calls `resolveSpawnTarget`, which wraps the
  command in `systemd-run --user --scope …` when containment is requested and
  `systemdScopeAvailable()` is true, then spawns the wrapper with the single `opts.env`.
- `packages/runtime-sdk/src/containment.ts` documents the failure mode in VS-639: with no
  `XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS` in the wrapper's environment, `systemd-run` cannot reach
  the user manager and dies before the command exists.
- The other runtimes (`claude`, `codex`, `opencode`, `gemini`, `cursor`) launch through
  `launchCommand(cmd, childEnv(overlay))`, which carries the daemon's full environment, so their
  contained spawns already have `XDG_RUNTIME_DIR`. Only the `weave` adapter scrubs it.

## Goals / Non-Goals

**Goals:**

- A contained `weave` worker turn starts: the wrapper can reach the user manager.
- The built-in agent's child environment stays exactly the allowlist plus its tool env; the wrapper's
  variables are not inherited by the agent.
- A wrapper that cannot start is reported as containment being unavailable, in words a human can act
  on — not as a runtime crash.
- No test invokes the live user manager or a real `systemd-run`/`systemctl`.

**Non-Goals:**

- Changing which runtimes are contained, the scope's memory settings, or the containment availability
  policy (`systemdScopeAvailable`).
- Widening the weave child env to the daemon's full environment (the other runtimes' approach).
- Containing the out-of-band `compactSession` child, which today spawns with no containment.
- Retrying a host that cannot contain a worker.

## Decisions

**1. A wrapper environment separate from the command environment, plus `env -u` inside the scope.**
`systemd-run --scope` execs the command locally, inheriting the wrapper's own environment, so setting
the bus variables only for the wrapper is not possible with a single environment: they would leak to
the agent. The chosen mechanism is therefore two-part and lives once in `runtime-sdk`: `spawnLines`
takes a new `containmentEnv` overlay that it merges into the environment of the `systemd-run` process
only, and the command placed inside the scope is prefixed with `env -u <key> …` for every key in that
overlay. A pure `planSpawn`-style builder is the single source of truth so the spawn and its tests agree.

*Alternatives considered:* passing `childEnv()` to the weave spawn, as the other adapters do — rejected
because it undoes the built-in agent's deliberate environment allowlist and would leak the user bus (and
other daemon variables) to the agent. `systemd-run --setenv=`/`-p Environment=` — rejected because those
apply to service mode, not `--scope`, and confirming that would mean running `systemd-run` against the
live manager, which this ticket forbids in a test.

**2. The `weave` adapter is the only opt-in.** It builds `containmentEnv` from the daemon environment
(`childEnv()`), keeping `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` when present, and leaves its
`env` as `childBaseEnv(base)` unchanged. The SDK option defaults to empty, so every other runtime's
spawn is byte-for-byte what it is today — no `env -u` is added, and their agents keep receiving the
variables they always did.

**3. A wrapper failure is classified, not guessed, from the real captured stderr.** The classifier
matches the exact systemd-run user-bus failure text captured from the VS-639 run:
`Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR
not defined`. That string is the fixture; patterns are written from those bytes, not from memory. The
classifier only applies when the process was actually wrapped (`scopeUnit !== null`) and produced no
`result`.

**4. The plain failure is `containment_unavailable`, family `tooling`, and it is not retried.**
`runtime-sdk` exposes `containmentFailed` on the spawn outcome; the weave adapter's `finish()` returns
`{code: 'containment_unavailable', family: 'tooling', message: 'Containment is unavailable: …'}` when it
is set. `tooling` is not in the engine's `RETRYABLE` list, so the run parks for a human instead of
burning retries on a host that cannot contain; the run's failure text is the message's first line,
which is already plain words (`plainFailureReason`, `engine.ts:976`).

**5. Silent uncontained re-run is refused.** The existing policy — "no systemd user manager, run
uncontained and log one notice" — is unchanged and applies only when `systemdScopeAvailable()` is
false, before any wrapper is attempted. When availability said yes and the wrapper still failed, the
host is broken; the run fails rather than dropping containment silently.

**6. Tests use injected availability and a fake spawn.** `spawnLines` gains an injectable spawn function
and an injectable availability decision (both defaulting to today's values). A test drives the contained
path with a fake process that writes the real bus text to stderr and exits, and asserts the adapter
returns `containment_unavailable`; no test spawns `systemd-run` or `systemctl`.

**7. Other scrub paths need no change.** `compactSession` (`adapter.ts:170`) uses `childBaseEnv` but
passes no `containment`, so it runs no wrapper and must not gain bus variables. `toolEnvFor` builds the
bash tool's environment from the same base but runs inside the already-started agent, so it is not a
wrapper and stays as narrow as it is.

## Risks / Trade-offs

- [The child-env assertion regresses the key-isolation guarantees] → the wrapper overlay only *adds*
  the two bus variables to the wrapper and strips them from the command; the existing
  "key never reaches argv or any environment" tests must stay green and are re-run.
- [`env -u` depends on the `env` binary being reachable inside the scope] → the wrapper inherits
  `PATH` from `childBaseEnv`, which is the daemon's `PATH`; `env` is coreutils on any host with
  systemd. If it were ever absent, the command would fail like any missing binary and be classified
  as a runtime crash — a state no worse than today.
- [A future systemd-run failure that is not the exact captured text] → the classifier names only the
  user-bus failure this ticket observed; other wrapper failures fall through to the existing crash
  classification, which at worst shows the wrapper's stderr as before.

## Migration Plan

No schema or data migration. After the code lands and the daemon is upgraded, a relaunch of the paused
VS-639 worker runs a contained turn that starts. Rollback is a code revert; no persisted format changes.

## Open Questions

None that change the specs or tasks.
