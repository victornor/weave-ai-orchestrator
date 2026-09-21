## Why

VS-639 was the first real worker turn on the built-in `weave` runtime, and it died 1.8 s in before the
agent existed: `Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and
$XDG_RUNTIME_DIR not defined`. The adapter scrubs its child environment down to `PATH`, `HOME`, `LANG`
and `TMPDIR` (`packages/runtimes/weave/src/child.ts` `childBaseEnv`), but that same environment is what
the `systemd-run --user --scope` containment wrapper is spawned with. `systemd-run` needs
`XDG_RUNTIME_DIR` (or `DBUS_SESSION_BUS_ADDRESS`) to find the user manager, so the wrapper failed before
it ever exec'd the agent. Every contained worker turn on the weave runtime on this host fails this way.
The other runtimes spawn with the daemon's fuller environment, which is why only `weave` is broken.

## What Changes

- The containment wrapper gets the user-bus variables it needs while the contained command does not:
  the spawn carries a **wrapper environment separate from the command's environment**, and the command
  executed inside the scope runs under `env -u <wrapper keys>` so a child env that is an explicit
  allowlist gains nothing. Implemented once in `runtime-sdk` as a `containmentEnv` spawn option, opted
  into by the `weave` adapter — not by widening the weave child env (what the other runtimes do).
- A `systemd-run` wrapper that cannot reach the user manager, despite availability being reported,
  **fails in plain words**: the run ends with a `containment_unavailable` error (family `tooling`) that
  says containment is unavailable, instead of `agent_crashed` carrying the bus text. The daemon does
  **not** silently re-run the command uncontained — that stays reserved for the existing
  "no systemd user manager reachable" policy, where no wrapper is attempted at all.
- The two other `childBaseEnv`/scrub paths are checked and left unchanged where no wrapper runs:
  `compactSession` spawns without containment, and the bash tool env runs inside the already-started
  child, not under a wrapper.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `runtime-launch/worker-memory-containment`: the wrapper must be given the user-bus environment it
  needs without widening the contained command's environment, and a wrapper that cannot start must
  fail as containment-unavailable in plain words rather than as a runtime crash.

## Impact

- `packages/runtime-sdk/src/process.ts` — `SpawnOpts` gains `containmentEnv`; the spawn plan sets the
  wrapper env on `systemd-run` and prefixes the contained command with `env -u`; a `containmentFailed`
  outcome for the wrapper failure.
- `packages/runtime-sdk/src/containment.ts` — pure helpers: the wrapper env picked from a source
  environment, and the classifier for `systemd-run`'s user-bus failure.
- `packages/runtimes/weave/src/adapter.ts` — build the turn spawn with `containmentEnv` from the
  daemon environment and map a failed wrapper to the plain-words error.
- Tests: `packages/runtime-sdk/src/process.test.ts`, `packages/runtime-sdk/src/containment.test.ts`,
  `packages/runtimes/weave/test/adapter.test.ts`; no live `systemd-run`/`systemctl` in any test.
- No schema or migration change.
