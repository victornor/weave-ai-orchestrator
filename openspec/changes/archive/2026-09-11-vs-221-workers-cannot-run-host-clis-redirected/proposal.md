## Why

OpenCode turns (VS-161) set the child's `HOME` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` to the
workspace runtime config home so the CLI does not load host skills from `~/.agents` and
`~/.claude`. mise then treats that directory as its install root, while `PATH` still carries the
host shim dir `/home/user/.local/share/mise/shims`. Every host mise CLI — including `openspec` —
fails inside and outside the repo with `not a valid shim`. Workers on Cursor/Claude/Codex/Gemini
are unaffected: they isolate via a dedicated config-dir env var and leave `HOME` alone.

Reproduced this turn (2026-09-11) by applying only OpenCode's overlay, no coding CLI launched:

| env | `mise current node` | `openspec --version` |
|---|---|---|
| this Cursor worker (host `HOME`) | 26.7.0 | 1.12.0 |
| OpenCode overlay (`HOME` = runtime dir) | 26.8.1 (runtime `…/runtimes/opencode/mise`) | `not a valid shim` (repo and `/tmp`) |
| same overlay + `MISE_DATA_DIR`/`CONFIG`/`CACHE` pinned to the host | 26.7.0 | 1.12.0 |

The redirect is skill isolation, not credential isolation (credentials stay on
`CLAUDE_CONFIG_DIR` / `CURSOR_CONFIG_DIR` / OpenCode XDG). Do not drop it.

## What Changes

- When a runtime overlay redirects `HOME` or the XDG dirs away from the daemon process, the
  child's env also pins `MISE_DATA_DIR`, `MISE_CONFIG_DIR`, and `MISE_CACHE_DIR` to the daemon
  host user's mise directories. Overlay `HOME` / XDG values stay. An explicit overlay `MISE_*`
  still wins.
- OpenCode `runTurn` spawns through `launchCommand` (like Claude and Cursor) so that pin actually
  reaches the process. Today it spreads `process.env` itself and never calls `childEnv`.
- Unit tests assert the pin from isolated env fixtures, not a live `openspec` on the developer
  machine.

## Capabilities

### New Capabilities

- `runtime-launch/host-clis`: a coding-CLI spawn whose overlay redirects `HOME` /
  `XDG_DATA_HOME` / `XDG_CONFIG_HOME` still resolves host mise CLIs; the redirect itself is
  unchanged.

### Modified Capabilities

(none — `opencode-runtime/skill-isolation` still requires `HOME` = config home; this change
adds the complementary host-CLI pin, it does not relax skill isolation)

## Impact

- `packages/runtime-sdk/src/launch.ts` — `childEnv` pins host mise roots when HOME/XDG are
  redirected; `launch.test.ts` covers redirected, non-redirected, and explicit-`MISE_*` overlay.
- `packages/runtimes/opencode/src/adapter.ts` — `runTurn` uses `launchCommand` then `spawnLines`
  with `launch.env` / `launch.cmd`.
- OpenCode `buildArgs` HOME/XDG assertions stay; skill isolation is unchanged.
- No schema, API, prompt, or `mise.toml` change. VS-170's pin rule remains for the different
  failure (CLI missing *only* inside a pinned repo).
- Out of scope: installing tools into the runtime; dropping the HOME redirect; converting
  Gemini/Codex to `launchCommand` (they do not redirect HOME); launching a real coding CLI.
