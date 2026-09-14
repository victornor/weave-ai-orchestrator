# Isolate opencode's XDG_STATE_HOME to the runtime home

Tracker change for [VS-436](weave://tickets/VS-436). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

The daemon launches each opencode worker turn with an env overlay that relocates `HOME`,
`XDG_CONFIG_HOME` and `XDG_DATA_HOME` to the per-workspace runtime home
(`<workspace>/.agent-conductor/runtimes/opencode`), but it leaves `XDG_STATE_HOME` untouched
(`packages/runtimes/opencode/src/args.ts`). The child environment is the daemon's whole environment
with that overlay on top (`childEnv` in `packages/runtime-sdk/src/launch.ts`), so `XDG_STATE_HOME`
inherited by the daemon — the host user's `/home/user/.local/state` on the live host — reaches the
worker verbatim.

opencode stores `opencode/model.json` there: its recent-model list, favourites and per-model
variants. That is the same file the host user's interactive opencode reads and writes. A worker
therefore reads the owner's last-used models and writes its own back into the owner's list. Any
opencode fallback to recent/last-used state, rather than the explicit `-m`, could silently pick the
owner's current choice. `XDG_CACHE_HOME` is likewise inherited today.

This is not the cause of the 2026-09-14 18:31Z stall (worker sessions logged
`providerID=deepseek modelID=deepseek-flash` throughout). The isolation gap is real regardless, and
it makes model problems hard to reason about.

## What changes

- `packages/runtimes/opencode/src/args.ts`: both `buildArgs` and `resumeCommand` set
  `XDG_STATE_HOME` and `XDG_CACHE_HOME` to `configHome` alongside `HOME`, `XDG_CONFIG_HOME` and
  `XDG_DATA_HOME`. `configHome` is already per workspace (`ctx.paths.runtimesHome` in
  `packages/core/src/runs/engine.ts`), so state is per-workspace by construction.
- `packages/runtimes/opencode/test/args.test.ts`: the isolation assertions cover all five keys,
  including that `XDG_STATE_HOME` is the runtime home and never the host user's directory.
- `packages/core/src/workers/resume-command.test.ts`: the human-resume path already exercises the
  adapter overlay; covered by the same args assertions (no behaviour change beyond the two new keys).

No other shipped adapter sets an `XDG_*` variable (`claude` uses `CLAUDE_CONFIG_DIR`, `codex`
`CODEX_HOME`, `cursor` `CURSOR_CONFIG_DIR`, `gemini` `GEMINI_CLI_HOME`), so opencode is the only
adapter this needs to change.

## Out of scope

Choosing or changing worker models, and the 2026-09-14 DeepSeek service stall.
