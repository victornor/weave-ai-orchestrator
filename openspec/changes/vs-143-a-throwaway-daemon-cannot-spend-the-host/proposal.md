## Why

`--config-dir` is the documented way to stand up an isolated, throwaway daemon for local testing, but it
does not isolate the Claude runtime credential: `credentialPaths()` (`packages/core/src/workspace/loader.ts`)
resolves the host side of the symlink from `process.env.HOME` unconditionally, so every daemon on a host —
throwaway or not — symlinks to the same `~/.claude/.credentials.json`. Separately, `conductor project add`
always creates a scout ticket and wakes the conductor, and the run dispatcher (`packages/core/src/runs/dispatcher.ts`)
turns any agent's queued wake into a spawned CLI turn with no notion of "ask first" — so adding a project to
a throwaway daemon autonomously spends real turns against the real login. On 2026-09-08 this happened by
luck without consequence (VS-143's incident report); it will not always be luck.

## What Changes

- A daemon SHALL be considered **isolated** when it starts from a config directory other than the plain
  default (`--config-dir` given, or `AC_CONFIG_HOME`/`XDG_CONFIG_HOME` set), unless an explicit opt-in flag
  says otherwise. This is a pure function of daemon startup options — no new flag is required to get the
  safe behavior.
- An isolated daemon SHALL NOT resolve any runtime's credential to the host's real credential file. Its
  runtimes get their own credential homes, scoped to its own config directory, so a throwaway daemon needs
  its own login for a runtime to actually work and can never touch or rotate the real one.
- An isolated daemon SHALL NOT autonomously dispatch a run — the run dispatcher's claim step is gated by
  the same isolation flag, so wakes still queue (nothing about ticket/job creation changes) but no CLI turn
  is spawned for them until a human explicitly asks. `conductor project add`'s scout ticket keeps being
  created (it is genuinely useful once a human decides to act on it) but sits waiting rather than running
  itself.
- An explicit opt-in (`--share-host-credentials` / `AC_SHARE_HOST_CREDENTIALS=1`) lets an operator who
  deliberately wants a second real daemon on the same host restore both the shared credential and
  autonomous dispatch. This is not the default for any custom config directory.
- `CLAUDE.md`'s "test against throwaway daemons only" guidance is corrected to say what an isolated daemon
  does and does not share with the host, and the project knowledge base is updated the same way.
- Documented finding (no code change): a sweep of other host-scoped state (`process.env.HOME`/`homedir()`
  usages across the repo) found no other sibling of the credential-symlink bug — the other host-path reads
  are either display-only, PATH-fallback binary discovery, or already resolve from the daemon's own
  `configDir`/`XDG_*` overrides rather than a fixed host path.

## Capabilities

### New Capabilities
- `daemon-isolation/credential-scope`: defines when a daemon does not resolve a runtime's credential to
  the host-shared file, and the opt-in that restores sharing.
- `daemon-isolation/dispatch-gate`: defines when a daemon does not autonomously spawn a run for a queued
  wake, and how a human explicitly dispatches one anyway.

### Modified Capabilities
- `runtime-credentials/single-credential`: the "one credential per runtime per host" requirement is scoped
  to a daemon that is not isolated; an isolated daemon is the documented exception, deferring to
  `daemon-isolation/credential-scope`.

## Impact

- `packages/core/src/workspace/loader.ts` — `credentialPaths()`/`linkRuntimeCredentials()` must stop
  reading `process.env.HOME` unconditionally and instead resolve the host credential home from the
  daemon's own isolation state.
- `packages/core/src/runs/dispatcher.ts` — `tick()`'s candidate query needs an isolation gate alongside its
  existing `needs_login` filter.
- `packages/server/src/daemon.ts`, `packages/server/src/bin.ts` — compute and thread the isolation flag
  (and the new opt-in flag/env var) from daemon startup into `WorkspaceContext`.
- `packages/core/src/context.ts` / `WorkspaceContext` construction — carry the isolation flag so both
  `loader.ts` and `dispatcher.ts` can read it without a new global.
- `CLAUDE.md`, the project knowledge base — corrected guidance.
- No change to `workspace-setup/setup-jobs` — the scout ticket sub-step is untouched; only its dispatch is
  gated.
