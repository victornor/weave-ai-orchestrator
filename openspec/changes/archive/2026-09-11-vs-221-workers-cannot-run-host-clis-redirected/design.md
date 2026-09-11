## Context

See proposal.md for the diagnosis. VS-161 (`opencode-runtime/skill-isolation`) sets
`HOME = XDG_* = configHome` in OpenCode `buildArgs`. Claude / Cursor / Codex / Gemini
isolate with `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`
and leave `HOME` on the host; this Cursor worker on 2026-09-11 had working `openspec`.

`childEnv` (`packages/runtime-sdk/src/launch.ts`) is the documented merge of daemon env
plus adapter overlay. OpenCode `runTurn` currently does that merge itself and never
calls `launchCommand` / `childEnv` (VS-155 called this out as the systemd PATH-empty
bug). A pin that lives only in `childEnv` would not reach OpenCode workers.

mise honours `MISE_DATA_DIR` over `XDG_DATA_HOME` / `$HOME/.local/share/mise`. Captured
under the OpenCode overlay this turn: `mise doctor` reported `data: ~/mise` (the runtime
dir); with the three `MISE_*` vars pointed at `/home/user/.local/{share,config,cache}/mise`,
`openspec --version` printed `1.12.0` in the worktree and in `/tmp`, and `HOME` still
expanded to the runtime dir (`~/.agents` was not the host's).

## Goals / Non-Goals

**Goals:**

- One merge point (`childEnv`) pins host mise roots when the overlay redirected HOME/XDG.
- OpenCode turns actually run through that merge point.
- Tests assert the env contract from isolated fixtures; they do not shell out to a real
  `openspec` or a coding CLI.

**Non-Goals:**

- Dropping or narrowing the HOME redirect.
- Installing `openspec` into the runtime mise.
- Rewriting PATH or replacing shims with versioned `…/installs/node/<ver>/bin` prefixes.
- Converting Gemini or Codex to `launchCommand`.
- Changing VS-170 prompt text.
- Changing this repo's `mise.toml`.

## Decisions

### Pin `MISE_*` in `childEnv`, computed from the pre-overlay daemon env

After copying `process.env` and applying the overlay, if `HOME`, `XDG_DATA_HOME`, or
`XDG_CONFIG_HOME` differ from the values that were on the daemon process, set:

```
MISE_DATA_DIR   ??= daemon MISE_DATA_DIR   ?? join(daemon XDG_DATA_HOME   ?? join(hostHome, '.local/share'), 'mise')
MISE_CONFIG_DIR ??= daemon MISE_CONFIG_DIR ?? join(daemon XDG_CONFIG_HOME ?? join(hostHome, '.config'), 'mise')
MISE_CACHE_DIR  ??= daemon MISE_CACHE_DIR  ?? join(daemon XDG_CACHE_HOME  ?? join(hostHome, '.cache'), 'mise')
```

`hostHome` is the daemon env's `HOME` (fall back to `os.homedir()`). Use `??=` so an
explicit overlay still wins.

Alternative considered: pin in OpenCode `buildArgs` only. Rejected — `buildArgs` is
documented pure (TurnInput → invocation); reading `os.homedir()` there would also miss
any later adapter that redirects HOME and already uses `launchCommand`.

Alternative considered: drop HOME redirect / stop setting XDG. Rejected — that reopens
the VS-161 host-skill leak. Credentials are not what the redirect protects; skills are.
`CLAUDE_CONFIG_DIR` / `CURSOR_CONFIG_DIR` / OpenCode XDG stay as they are.

Alternative considered: prepend the host node bin
(`/home/user/.local/share/mise/installs/node/26.7.0/bin`) on PATH. Rejected — version- and
tool-specific; the VS-219 workaround. Pinning mise roots fixes every host mise shim.

Alternative considered: `os.userInfo().homedir` instead of daemon `HOME`. Unnecessary
while the daemon process keeps the host user HOME (systemd user unit). Pre-overlay
`env.HOME` is the same value `childEnv` already copies.

### OpenCode `runTurn` uses `launchCommand`

Same three lines Claude and Cursor already have: `launchCommand(built.cmd, built.env)`
then `spawnLines({ cmd: launch.cmd, env: launch.env, … })`. That is what makes the pin
reach OpenCode workers. It also gives OpenCode the VS-73 systemd PATH fallback, which
it still lacks.

Do not convert Gemini/Codex in this ticket: they do not redirect HOME.

`buildArgs` keeps setting HOME/XDG; existing args tests stay. The pin is not OpenCode's
job.

### Tests isolate daemon HOME and XDG, then overlay a different HOME

`launch.test.ts` already stubs `HOME` per test. New `childEnv` cases must also stub
`XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` (this worker's process has the
real ones set). Cases:

1. Overlay `HOME` + XDG to a temp config-home → `MISE_*` under the stubbed daemon home;
   overlay HOME/XDG preserved.
2. Overlay only `CLAUDE_CONFIG_DIR` (existing test) → no `MISE_*` injected.
3. Overlay `HOME` and `MISE_DATA_DIR` → overlay `MISE_DATA_DIR` kept.

Do not add a live-`openspec` test: the suite must not depend on the host toolchain.
The env contract is the behaviour; the 2026-09-11 overlay reproduction is the
documented check that that contract is the one that unblocks `openspec --version`.

## Risks / Trade-offs

- [A worker can `mise install` / `mise use` into the host mise] → Same as a working
  host shell. Accept. Isolation we keep is skills and runtime credentials, not the
  host toolchain.
- [Daemon HOME is itself a runtime dir] → then "host" mise is that dir and the pin is
  a no-op. The production daemon's HOME is the host user.
- [mise grows a new root env var we did not pin] → `MISE_STATE_DIR` already resolved
  to `/home/user/.local/state/mise` under the overlay (OpenCode does not set
  `XDG_STATE_HOME`). Revisit if a future mise release needs it.
- [OpenCode `launchCommand` resolves `opencode` to a different binary than today] →
  Intended: same resolution Claude/Cursor use. Adapter tests do not spawn `opencode`
  for a turn today.

## Migration Plan

Code-only. Next OpenCode spawn after deploy inherits the pin. Cursor/Claude/Gemini
spawns unchanged. Rollback is revert.

## Open Questions

None.
