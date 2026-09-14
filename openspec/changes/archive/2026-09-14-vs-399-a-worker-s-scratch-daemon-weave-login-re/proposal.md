# Scratch CLI use never touches the host's contexts

Tracker change for [VS-399](weave://tickets/VS-399). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

On 2026-09-14 the VS-378 worker verified V2 against a scratch daemon and ran `weave login` at it.
`packages/cli/src/contexts.ts` `contextsPath()` resolves to `$AC_CONTEXTS_FILE` or the user's config
home, and the scratch workflow set neither, so the login wrote a `vs378scratch` context into the
host's shared `~/.config/agent-conductor/contexts.yaml` and set `current: vs378scratch`. The scratch
daemon was then stopped: every bare `weave` command on the host pointed at a dead port until a human
switched `current` back, and the worker's own attempt to fix it was correctly refused by its sandbox.

`--config-dir` isolates the *daemon*; it says nothing about the *CLI's* contexts file. The helper
(`scripts/scratch-daemon.sh`) and the docs said how to start and stop a scratch daemon safely, but
not how to talk to one without repointing the host's CLI.

## What changes

- **The scratch helper isolates every CLI call.** `scripts/scratch-daemon.sh` derives
  `AC_CONTEXTS_FILE`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` under its scratch dir and prints the
  exact exports for follow-up `weave` commands (`scripts/scratch-daemon.sh env`, and on `start`).
- **`weave login` refuses to write a scratch context to the host file.** A loopback URL on a port
  other than the default (`7433`) with no `AC_CONTEXTS_FILE` set is refused, naming
  `AC_CONTEXTS_FILE`, unless the caller passes the explicit `--allow-default-contexts` override.
- **The test suite can never write the host's contexts file.** `vitest.setup.ts` pins
  `AC_CONTEXTS_FILE` at a throwaway path under the same temp dir as `XDG_CONFIG_HOME`, so no test
  reaches the real file even if it forgets to isolate.
- **Guidance says never to point the host CLI at a scratch daemon.** `CLAUDE.md` and the worker skill
  name the isolated env and forbid `weave login`/`weave context use` against the host's contexts.

## Out of scope

- Any change to how the daemon resolves contexts, or to `weave context use` on a genuinely isolated
  file (switching `current` there is the point of the command).
- Host-specific cleanup: the change is general, and this ticket never reads or edits the real
  `~/.config/agent-conductor/contexts.yaml`.
