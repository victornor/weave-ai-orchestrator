# Design — opencode XDG state isolation

## Where the environment is built

`buildArgs` (turn) and `resumeCommand` (human handover) in
`packages/runtimes/opencode/src/args.ts` return the adapter's env **overlay**. The turn path merges
that overlay onto the daemon's own environment in `childEnv`
(`packages/runtime-sdk/src/launch.ts`), so any key the overlay does not name is inherited from the
daemon process — including `XDG_STATE_HOME` (and `XDG_CACHE_HOME`) when the daemon itself runs under
one.

## Fix

Set both missing XDG roots in the overlay, next to the three already relocated:

| key | value |
|---|---|
| `HOME` | `configHome` |
| `XDG_CONFIG_HOME` | `configHome` |
| `XDG_DATA_HOME` | `configHome` |
| `XDG_STATE_HOME` | `configHome` (new) |
| `XDG_CACHE_HOME` | `configHome` (new) |

`configHome` is `join(ctx.paths.runtimesHome, runtime)` (`packages/core/src/runs/engine.ts`), and
`runtimesHome` is per workspace, so every workspace gets its own state and cache directory the way it
already gets its own config and data directories.

## Why cache is isolated rather than shared

Sharing a cache is safe in principle (it is derived, not authored), but the ticket asks for it to be
isolated or justified. Isolating it is one line and removes the question: a per-workspace cache also
avoids a worker's cached provider metadata colliding with the owner's. There is no reason to keep
the host's.

## Non-goals

- Touching `childEnv` or the other adapters: they use dedicated config-dir variables
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CURSOR_CONFIG_DIR`, `GEMINI_CLI_HOME`) and set no `XDG_*`
  overlay, so they are out of this change's scope.
- The mise pin (`pinHostMiseRoots`) is unaffected: it keys on `HOME`/`XDG_DATA_HOME`/
  `XDG_CONFIG_HOME`, all still relocated, and reads `MISE_*` from the daemon's own env.
