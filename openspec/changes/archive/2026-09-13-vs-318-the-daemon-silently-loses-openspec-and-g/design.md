## Context

`weave daemon install-service` writes a systemd user unit that sets only `AC_CONFIG_HOME`; the unit
inherits whatever `PATH` the user manager has at the moment it starts. The daemon's own tools
(`git`, `gh`, `openspec`, `wt`) are then resolved from that inherited `PATH`
(`packages/core/src/tools/host.ts`, `packages/core/src/openspec/cli.ts`). On 2026-09-13 the daemon
started at 03:38, before the user session published its `PATH`, so it saw only
`/usr/local/bin:/usr/bin` while `openspec` and `gh` live under `~/.local/share/mise/installs/…`.
Every `proposed` gate failed, PR delivery was blocked, and the failures claimed the binaries were
not installed.

There are four defects: resolution depending on the inherited `PATH`; a not-found tool reported as
"not installed"; no visibility when a host tool is unavailable; and `weave_openspec_status`
answering with an empty plan when the binary cannot run.

## Decision 1 — Resolve the host tool PATH from the user's own environment, generically

The fix must work on a deployment we have never seen — a different distribution, a different tool
manager (mise, asdf, nvm, Homebrew, a global `npm -g`), launchd as well as systemd. So it must not
enumerate this host's directories, and it must not name one tool manager. It stops treating the
inherited `PATH` as the source of truth and instead **asks the daemon user's login shell what its
`PATH` is**, then merges that into the daemon's own process `PATH` once, at startup, before any
workspace loads and before any host tool is spawned.

Asking the user's login shell is the general source: the shell's rc files are exactly where every
tool manager publishes its bin directory, so mise, asdf, nvm, Homebrew and `npm -g` are all covered
without the code knowing any of them. Querying each package manager directly ("its reported bin
path") was considered and rejected — reaching a manager's own command already requires it on
`PATH`, it means hardcoding manager names, and the shell has already done the same job in one
place. The command runs as the daemon user's login *and interactive* shell (the interactive shell
is what sources the rc that activates a manager), with stdin closed, a short timeout, and a
sentinel around the value so rc banners cannot be mistaken for the answer; the output is parsed
from stdout only. The shell is chosen by falling back `$SHELL` → the account's shell
(`os.userInfo().shell`) → `/bin/sh`, because `$SHELL` is not guaranteed to be set under systemd or
launchd. A shell that fails, times out, or prints nothing contributes nothing and is logged.

`PATH` is assembled in this order: the configured `hostToolPaths` first (operator intent), then the
login shell's entries, then the process's existing entries. Each directory appears at most once. A
tool already resolved earlier wins over one discovered later, so this cannot silently shadow a
working install; discovery only fills gaps. `AC_OPENSPEC_BIN` stays the explicit per-binary override
and still wins. Because every spawn in the daemon inherits `process.env`, one startup merge covers
`openspec`, `gh`, `wt`, `git`, `git`'s hooks, and the coding-CLI launchers — not just the call sites
we remember to touch. This survives a reboot where the daemon starts before the user's session, and
it needs no reinstall on any existing deployment.

Two mechanisms, neither a host-specific patch:

- **Resolution from the user's environment (chosen, the fix).** Deployment-agnostic, works for
  every existing install without a reinstall, survives the boot ordering, and covers child
  processes. It also covers a fresh install at its first start, so nothing else is needed for the
  installer's case.
- **`hostToolPaths` as a daemon setting (escape hatch).** A `hostToolPaths: string[]` field on
  `DaemonConfigSchema`, applied ahead of the login-shell `PATH`, for the unusual layout the shell
  does not cover. A deployment works with zero configuration; this only helps the exception.
  Captain's rule is that a new daemon setting is reachable in Settings, so it gets a **Host tools**
  section under the daemon area, showing each tool's availability and resolved path and editing the
  directory list. It persists to `daemon.yaml` and is re-applied live, exactly like the dictation
  and models routes (`packages/server/src/routes/daemon.ts`): the route re-runs resolution and
  clears the detection cache, no restart.

Rejected: **writing the installer's `PATH` into the unit or plist.** The value depends on the
directory `install-service` runs from, so running it from a repo with a mise Node pin bakes that
pin's bin directory into every unit — and a pinned Node can hide `openspec` altogether (AGENTS.md →
Host CLIs). A frozen snapshot is exactly the failure mode this decision removes, and resolution at
startup already covers a fresh install, so the installer change earns nothing and can actively
mislead.

## Decision 2 — Distinguish "not on the daemon's PATH" from failure, and carry the PATH

`isEnoent` maps a spawn's `ENOENT` to `openspec_not_found`, and the gate surfaced that as "the
openspec binary is not installed" (`packages/core/src/openspec/index.ts`). Both halves are wrong:
the condition is about the daemon's search path, and the text sends people to reinstall a working
tool. The not-found error message is rewritten to name the daemon's `PATH` (and the directories
searched, for the resolver path), and the gate message reuses it. A binary that *is* found and
exits non-zero still takes the `failed()` branch and is reported as a failure — the distinction
already exists in the code and is now asserted by a test, so "present but broken" never reads as
"not installed".

## Decision 3 — Visibility: a daemon-wide notice and a briefing warning

The requirement is that unavailability is visible without anyone remembering to probe `/api/health`.
Two surfaces, matching the two audiences, built from one detection snapshot:

- **The weaver**: `briefing`'s `warnings` array (`packages/core/src/briefing/service.ts`) gains a
  line per unavailable required/recommended tool, read synchronously from the last detection
  snapshot. `warnings` is the established "the weaver is told" channel, and the render already
  bounds and redacts it.
- **The human**: a daemon-wide notice in the web app, modelled on the unconfigured-models banner
  (`packages/ui/src/app/AppShell.tsx`): shown while any required/recommended host tool is
  unavailable, naming the tool and the daemon's `PATH`, linking to daemon Settings → Host tools.
  Unmissable, self-clearing, and it needs no schema.

A detection probe runs at startup and on a timer, and also backs the Host tools route and
`/api/health`; the snapshot the briefing reads is whatever the last probe found. Extending the
incidents service with a daemon-originated reporter kind was considered and rejected for this
change: it would add a reporter kind, a null-identity path and a resolution lifecycle for a
condition that is transient and clears itself the moment the tool returns. If the operator wants a
durable record, the notice names the tool and the fix.

## Decision 4 — weave_openspec_status errors when the binary cannot run

`statusFor` currently catches `openspec_not_found` and returns `zeroStatus`, which is how V OFM's
weaver came to report "the daemon sees no change artifacts". The zero status is correct only when
there is genuinely nothing to read: a ticket with no change, a project with no `openspec`
directory, or OpenSpec disabled. Those cases already return before the binary is invoked. When the
`resolve()` guard passes — the change exists on disk — but the binary cannot run, `statusFor` now
propagates the error, so the tool returns `ok: false` with the not-found condition and the daemon's
`PATH`, and the caller can tell "cannot run openspec" apart from "nothing planned". The same
correction applies to `validateForProposed`, whose message must carry the `PATH`.

## Testing

- **Resolution against a bare PATH, host-independently**: a scratch directory holding a fake
  executable `openspec`, and a fake login shell (a small script replacing `$SHELL`) that prints a
  `PATH` containing that directory. With the process `PATH` set to `/usr/bin:/bin` and the fake
  shell injected, the startup resolution must add the directory and `detectHostTool('openspec')`
  must report the fake available. Nothing reads this host's layout or launches the real CLI, and the
  live daemon is never touched (`AGENTS.md` rule).
- **Message shapes** are asserted as pure functions: the not-found message contains the `PATH` and
  the words "not found on the daemon's PATH" and never "not installed"; a found-but-failing tool
  produces the `failed` message instead.
- **Shell selection**: with `$SHELL` unset, the resolver falls back to the account shell and then
  `/bin/sh`; a test covers the unset-`$SHELL` case.
- **Visibility** is asserted at the model level: with the snapshot reporting `gh` unavailable, the
  briefing `warnings` contains `gh` and the `PATH`; with it available, the warning is gone. The
  banner renders from the same data.
- **Setting**: a `hostToolPaths` entry pointing at a scratch directory holding a fake tool is
  applied and detected without a restart.
- **`weave_openspec_status`**: a fake openspec that cannot run makes the tool error; a project
  directory with no `openspec` still returns the zeroed status.
- `pnpm lint`, `pnpm typecheck`, and both suites (`pnpm test` runs the core/server suite and the UI
  suite; totals pasted verbatim in the report).

## Risks

- **Login shell cost or hang**: the query runs once at startup with a bounded timeout, stdin
  closed, and stdout-only parsing; a slow or broken shell contributes nothing and the daemon still
  starts.
- **PATH growth**: each directory is added at most once, so a long-running daemon does not
  accumulate entries.
- **Shadowing**: configured directories and the login shell's entries precede the inherited `PATH`,
  and nothing is discovered from a hardcoded machine list, so the only thing the merge can override
  is the bare `PATH` this change exists to correct; each directory is added at most once.
