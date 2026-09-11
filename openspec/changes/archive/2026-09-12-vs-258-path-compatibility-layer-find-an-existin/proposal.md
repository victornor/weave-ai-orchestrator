## Why

captain is renaming this project (`agent-conductor` → `weave-ai`, CLI `conductor` → `weave`, agent kind
`conductor` → `weaver`; VS-257 is the full inventory). The system runs on the names being renamed: a
code-only rename produces a daemon that looks for a config directory, a data directory and a
workspace database that do not exist, because everything on disk today was created under the old
names. That failure never shows up as a failing test — it shows up as a daemon that treats an
initialised workspace as new. This change ships the fallback first, while the new name never exists on
disk anywhere, so nothing observable changes yet; when the rename itself lands later, the
compatibility layer is already deployed and only has to be exercised, not written under pressure.

## What Changes

- Add one path-family resolver per duplicated location VS-257 found, each collapsing what are today
  two or three independent copies of the same directory literal into a single exported function:
  - user-level config directory (`~/.config/{agent-conductor,weave}`)
  - user-level data directory (`~/.local/share/{agent-conductor,weave}/{releases,current,previous}`)
  - user-level state directory (`~/.local/state/{agent-conductor,weave}`)
  - per-workspace state directory + conductor home (`.agent-conductor/` + `conductor/` vs. `.weave/` +
    `weaver/`), resolved together as one decision, keyed on whichever side's `db.sqlite` exists — and
    consumed by every call site that needs a workspace's directory, not only `workspacePaths()`
- A single shared decision primitive (`resolveInstallPath`) implements the policy every resolver
  above uses: new name if it alone exists, old name if it alone exists, new name when neither exists
  (a fresh install), and a loud refusal — never a silent pick — when both exist.
- Fix six previously unlisted duplicates found by grepping the whole repo rather than trusting the
  starting inventory, all consumers that rebuilt a per-workspace path instead of asking the resolver
  for it: `initWorkspace`'s hardcoded `.agent-conductor/.gitignore` write; `backupDatabases()`'s two
  independent copies (`packages/server/src/upgrade.ts` and `packages/cli/src/commands/daemon.ts`,
  the same function maintained twice) each rebuilding a workspace's db path, which today means a
  workspace resolved to the new name is **silently skipped** by the pre-upgrade backup — no error, no
  file written, nothing in the returned list; and `packages/cli/src/commands/runtime.ts`'s runtime
  login, which rebuilds the workspace's runtimes directory, so a `runtime login` under the new name
  writes credentials into a directory the daemon never reads, and the worker just looks logged out.
- `isDefaultConfigDir` (VS-143's isolation boundary) is taught to recognise either name's plain
  default as "the default," compared independently of the ambiguity-refusal path, so an isolated test
  daemon's isolation check cannot be made to throw by an unrelated ambiguous host installation.
- No migration, no directory move, no renaming of anything else. Both names are made *readable*;
  converting an installation from one to the other is explicitly out of scope and left for later.

## Capabilities

### New Capabilities
- `path-compatibility`: how the daemon and CLI resolve a user-level or per-workspace directory that
  may exist under an old or a new name, including the both-exist refusal and the fresh-install default.

### Modified Capabilities
- `daemon-isolation/credential-scope`: "the plain default config directory" (used to decide whether a
  daemon is isolated) must recognise both the old-named and new-named default, not only the literal
  path it compares against today.

## Impact

- `packages/release/src/index.ts` (new `resolveInstallPath` primitive for the user-level families,
  plus `resolveWorkspaceStateDir(root)` — the single place that decides a *per-workspace* directory's
  name, built on the same primitive; `configDir()`/`stateHome()`/`dataHome()`/`releasesDir()`/
  `currentLink()`/`previousLink()` all route through one or the other)
- `packages/core/src/workspace/loader.ts` (`configDir()`/`plainDefaultConfigDir()`/
  `isDefaultConfigDir()` call the collapsed resolver instead of a local literal; `initWorkspace`'s
  `.gitignore` write)
- `packages/core/src/context.ts` (`workspacePaths()` calls `resolveWorkspaceStateDir()` and builds the
  per-workspace state/conductor names together from its answer)
- `packages/cli/src/contexts.ts` (`configHome()`/`stateHome()` become thin call-throughs, dropping
  their own literals)
- `packages/server/src/upgrade.ts` and `packages/cli/src/commands/daemon.ts` (`backupDatabases()`'s
  two independent copies both call `resolveWorkspaceStateDir()` for each registered workspace instead
  of rebuilding the literal, so an ambiguous workspace is a loud failure of the backup rather than a
  silently skipped one)
- `packages/cli/src/commands/runtime.ts` (`runtime login`'s config-home path calls
  `resolveWorkspaceStateDir()` instead of rebuilding the literal)
- `packages/server/test/fakes.ts:341`'s hand-built `WorkspaceContext.paths.state` literal is left as
  is — it is a synthetic fixture value never routed through any resolver, so nothing about this change
  makes it stop testing what it tests; a comment is added so a future reader does not mistake it for
  exercising resolution behavior (see design.md)
- `packages/core` gains a dependency on `@agent-conductor/release` (a leaf package with zero
  dependencies of its own; no cycle)
- `packages/shared/src/errors.ts` (new `ambiguous_install_path` error code for the workspace-level
  refusal, which core already has the machinery to throw and report)
