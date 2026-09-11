## Context

See `proposal.md` - Why. The five duplicated path literals VS-257 found, and where each lives today,
are catalogued in the ticket description and in VS-257's report (`ac_ticket_document_get VS-257
report`); this document does not repeat that table, only the choices made about it.

Package boundaries (`CLAUDE.md`, enforced by `scripts/guard-boundaries.mjs`): `packages/shared`
imports nothing from `@agent-conductor/*` (it is bundled into the browser `ui` build, so it must stay
free of `node:*` imports). `packages/release` is documented as a leaf that "imports nothing from
`@agent-conductor/*`" and is already the single source for the data-directory family
(`dataHome()`/`releasesDir()`/`currentLink()`/`previousLink()`), consumed by both `packages/cli`
(directly) and `packages/server`/`packages/core` (indirectly, or not at all today). `packages/core`
does not currently depend on `@agent-conductor/release`; nothing forbids adding that edge (release
has zero dependencies of its own, so no cycle), and both `core` and `cli` already depend on it or can.

## Goals / Non-Goals

**Goals:**
- One resolver per path family (proposal's "Impact" list), each with exactly one place that spells
  the old-name and new-name path segments — and every consumer of that family routed through it, not
  only the site the family was first found at.
- A single shared decision primitive for "old, new, fresh, or ambiguous," used by every family.
- Keep `packages/release` and `packages/shared` leaf-clean: neither gains a new
  `@agent-conductor/*` dependency.

**Non-Goals:**
- Moving, migrating, or symlinking anything between the two names (proposal's own non-goal).
- Renaming the CLI binary, package scopes, DB-stored `'conductor'` values, or any prose. Those are
  VS-257's other rows and separate tickets.
- A generic "two-name" abstraction usable for arbitrary future renames. This is a one-time
  compatibility layer for exactly the rename in progress, not a reusable framework.

## Decisions

### 1. The shared decision primitive lives in `packages/release`, and does not throw

```ts
// packages/release/src/paths.ts (new file)
export type InstallPathResolution =
  | { status: 'old' | 'new' | 'fresh'; path: string }
  | { status: 'ambiguous'; oldPath: string; newPath: string };

export function resolveInstallPath(oldPath: string, newPath: string): InstallPathResolution {
  const oldExists = existsSync(oldPath);
  const newExists = existsSync(newPath);
  if (oldExists && newExists) return { status: 'ambiguous', oldPath, newPath };
  if (newExists) return { status: 'new', path: newPath };
  if (oldExists) return { status: 'old', path: oldPath };
  return { status: 'fresh', path: newPath };
}
```

`release` cannot depend on `@agent-conductor/shared` (it would stop being the leaf `CLAUDE.md`
documents it as), so it cannot throw `OcError`. The primitive is therefore non-throwing: it returns a
discriminated union and lets each caller decide what "ambiguous" means in its own idiom. This is the
"package boundary genuinely forbids it" case the ticket asked callers to name explicitly.

- **`configDir()`/`dataHome()`/`stateHome()`** (all three now in `packages/release`, alongside the
  existing `releasesDir()`/`currentLink()`/`previousLink()` which are built on `dataHome()`) throw a
  plain `Error` on `ambiguous`, matching `release`'s existing style elsewhere in the same file (e.g.
  `pnpm()`'s `throw new Error('no pnpm: ...')`). The CLI and daemon's existing top-level error
  handling already prints a thrown `Error`'s message and exits non-zero; no new plumbing is needed
  for the user-level families.
- **`workspacePaths()`** (`packages/core/src/context.ts`) throws `OcError('ambiguous_install_path',
  ...)` on `ambiguous`, matching every other core invariant violation, with both candidate paths in
  `details`. Core already depends on `shared` for `OcError` elsewhere in this same file's callers.

Alternative considered: put the primitive in `packages/shared` so every package could reach it
without a new dependency edge. Rejected — `shared` is bundled for the browser (`packages/ui` depends
on it) and has zero `node:fs`/`node:os`/`node:path` usage today; adding a filesystem-touching
function there would be the first `node:*` import in a package that must stay isomorphic.

Alternative considered: a new leaf package dedicated to path resolution. Rejected as unnecessary
structure for two functions when `packages/release` already is exactly this kind of leaf, already
owns one of the five families, and adding to it costs no new package, no new dependency edges beyond
`core → release`, and no renaming.

### 2. `packages/core` takes a direct dependency on `@agent-conductor/release`

`configDir()` is defined independently today in both `packages/core/src/workspace/loader.ts` and
`packages/cli/src/contexts.ts`. Collapsing it to one implementation means one of the two calls
through to the other, or both call a common third place. Since `cli` already depends on `release` and
`core` cannot depend on `cli` (`guard-boundaries.mjs`), the common place is `release`; `core` gains
that one new dependency edge. `packages/cli/src/contexts.ts`'s `configHome()`/`stateHome()` become
thin re-exports of `@agent-conductor/release`'s `configDir()`/`stateHome()` (keeping their existing
names at the `contexts.ts` call sites, since renaming those is not in scope), the same pattern
`packages/cli/src/release.ts` already uses (`export * from '@agent-conductor/release'`).

### 3. Per-workspace state directory and conductor home resolve together, keyed on `db.sqlite` —
   and the decision itself lives in `packages/release`, not only in `workspacePaths()`

`workspacePaths(root)` builds both `.agent-conductor/`-or-`.weave/` (the `state` family) and
`conductor/`-or-`weaver/` (the `conductor` family) from a **single** old/new decision, not two
independent ones. Resolving them independently could produce `.weave/db.sqlite` paired with
`conductor/` (mismatched halves of the same workspace) if the two families' existence checks ever
disagreed — a strictly worse failure mode than either uniform choice. The existence check is `db.sqlite`
under the state directory, not the directory's own presence: `ensureLayout()`
(`packages/core/src/workspace/loader.ts`) `mkdirSync`s the resolved state directory (and the
conductor directory) before the database is opened, so a directory-presence check would see its own
side effect as "already installed" on the very first fresh boot. `db.sqlite`'s presence is the
concrete signal the ticket names in its acceptance criteria and is written only once the workspace is
genuinely initialised.

Revised after plan review: `workspacePaths()` is not the only place that needs this decision.
`packages/server/src/upgrade.ts` and `packages/cli/src/commands/daemon.ts` each maintain an
independent `backupDatabases()` that rebuilds a workspace's db path from the literal to back it up
before an upgrade, and `packages/cli/src/commands/runtime.ts` rebuilds the workspace's runtimes
directory for `runtime login` — three consumers VS-257's table did not list, found by grepping the
whole repo for the literal rather than only the files already touched. All three need the *same*
per-workspace old/new/fresh decision `workspacePaths()` makes, but none of them can reach it: `cli`
does not depend on `@agent-conductor/core` (a real, much heavier dependency edge than this ticket's
scope justifies — core pulls in `db`, `runtime-sdk`, `channel-sdk`, `surface-sdk`, `plugin-sdk`,
`argon2`, `jose`, `otplib`, `execa`, none of which the CLI needs for a backup path), and `server`'s
`upgrade.ts`, while it does depend on core, would otherwise be pulling in the whole `WorkspacePaths`
object (conductor home, secrets, attachments — none of which a backup routine needs) just to reach
one field.

The decision itself is therefore exposed from `packages/release` — the same leaf both `core` and
`cli` already reach for the user-level families — as its own small function, independent of
`workspacePaths()`:

```ts
// packages/release/src/paths.ts
export type WorkspaceInstallStatus = 'old' | 'new' | 'fresh';
export interface WorkspaceInstall { status: WorkspaceInstallStatus; stateDir: string }
export function resolveWorkspaceStateDir(root: string): WorkspaceInstall {
  const r = resolveInstallPath(join(root, '.agent-conductor', 'db.sqlite'), join(root, '.weave', 'db.sqlite'));
  if (r.status === 'ambiguous') throw new Error(`ambiguous workspace install at ${root}: both ${r.oldPath} and ${r.newPath} exist`);
  return { status: r.status, stateDir: r.status === 'old' ? join(root, '.agent-conductor') : join(root, '.weave') };
}
```

`workspacePaths()` calls this and builds every sibling field (`db`, `runs`, `runtimesHome`,
`wtConfig`, `secretsFile`, `secretsKey`, `attachments`, and `conductor`-vs-`weaver`) from its
`stateDir`/`status`; it wraps the plain `Error` into `OcError('ambiguous_install_path', ...)` the way
core does everywhere else. `upgrade.ts`'s and `daemon.ts`'s `backupDatabases()` call it for each
registered workspace and join `db.sqlite` onto `stateDir`; `runtime.ts` joins `runtimes/<id>` onto it.
This is the same "one exported function per family" rule the ticket asked for, applied to a family
this ticket's own starting inventory under-counted — the resolver only holds its guarantee for
callers that actually use it, and these three did not.

### 4. The pre-upgrade backup refuses loudly on an ambiguous workspace instead of silently skipping it

Today, both copies of `backupDatabases()` skip a source file that doesn't exist
(`if (!existsSync(src)) continue;`) with no error and no entry in the returned list. Once a workspace
can resolve under either name, a workspace that happens to be running on the new name would be
silently skipped by a naive port of the same existence check (it would check only the old-named
path). Routing both copies through `resolveWorkspaceStateDir()` fixes this by construction: the
function itself resolves to whichever name the workspace's `db.sqlite` actually lives under (not a
literal), so the existence check downstream (`existsSync(join(stateDir, 'db.sqlite'))`, still needed
because a workspace can be registered without ever having booted) is checking the *right* path
regardless of which name won. An ambiguous workspace throws instead of being silently skipped or
silently backed up from the wrong side — the one moment a backup has to be real is exactly the
upgrade that carries this rename, so failing loudly here is the correct default, consistent with
Decision 6 below.

### 5. `isDefaultConfigDir` compares against both plain defaults directly, not through the resolver

`daemon.ts`'s `resolveIsolation()` calls `isDefaultConfigDir(configDir)` for whatever config
directory a daemon was actually started with — including a throwaway test daemon pointed at an
unrelated scratch directory. If that comparison were implemented by calling the (throwing)
`resolveInstallPath` on the plain-default candidates, an ambiguous *host* installation (both
`~/.config/agent-conductor` and `~/.config/weave` present) would make the isolation check throw for
every daemon on that host, including ones that are not using either default at all. Instead,
`plainDefaultConfigDir()`'s comparison recognizes either literal plain-default path directly:

```ts
function isDefaultConfigDir(resolved: string): boolean {
  const r = resolve(resolved);
  return r === resolve(join(homedir(), '.config', 'agent-conductor')) || r === resolve(join(homedir(), '.config', 'weave'));
}
```

This is deliberately independent of `configDir()`'s own resolution (and therefore of the ambiguity
refusal): recognising identity does not require resolving between two candidates.

### 6. Explicit overrides bypass resolution entirely, unchanged

`AC_CONFIG_HOME`, `AC_CONTEXTS_FILE`, and `loadWorkspace`'s `opts.stateDir` already short-circuit
before any old/new logic runs today; that ordering is preserved exactly (checked first, returned
immediately, `resolveInstallPath` never called). This is what lets every existing test that points at
a throwaway directory keep working unmodified, and it is what the spec's "explicit override" scenario
asserts.

### 7. Refuse uniformly; no "prefer new and warn" variant

The ticket's acceptance criteria name two acceptable behaviors for the both-exist case: refuse, or
prefer the new one and warn. This design refuses in every family, including the user-level ones,
rather than mixing policies. "Prefer new and warn" is actively wrong for the case the ticket calls out
as mattering most (`workspacePaths()`): a stray, empty or partially-migrated new-named directory would
silently win over the real database, which is the exact failure this ticket exists to prevent.
Applying a different policy to the "less risky" families would mean two policies to reason about and
document instead of one; refusing everywhere is the simpler, more conservative choice and the one
that is safe to apply uniformly without per-family judgment calls.

### 8. The `initWorkspace` `.gitignore` literal (found during this design, not in VS-257's table)

`packages/core/src/workspace/loader.ts`'s `initWorkspace()` writes
`join(root, '.agent-conductor', '.gitignore')` directly, bypassing `workspacePaths()` entirely — a
sixth duplicate of the per-workspace state directory literal that VS-257's scout report did not list.
This change routes it through `workspacePaths(root).state` like everything else under that directory,
since acceptance criterion 1 ("no package spells `agent-conductor` as a path segment in more than one
place") is violated by it as written.

### 9. `packages/server/test/fakes.ts:341`'s hardcoded `.agent-conductor` literal is left alone, deliberately

This fake builds a `WorkspaceContext.paths` object by hand (`state: '/tmp/ws/.agent-conductor'`) for
route tests; it never calls `workspacePaths()` or any resolver. Two options were weighed: route it
through `resolveWorkspaceStateDir()`/`workspacePaths()` like production code, or leave it as a literal
double. Chosen: leave it, because nothing about this change makes the fake stop testing what it
appears to test — it never exercised path *resolution* in the first place, only route handlers that
consume an already-built `paths` object, and it isn't the vehicle for this ticket's acceptance
criteria (those are covered by real tests against `workspacePaths()` and the release-package
functions directly, per tasks.md §§1-4). Rejected: replacing it with a call through the real resolver
would make this one fake path depend on the filesystem shape of `/tmp/ws` at test time, which none of
the other hand-built fields in the same object do — an inconsistent, one-off change to a fixture this
ticket doesn't otherwise need to touch. A one-line comment is added at the literal instead, saying it
is a synthetic double never routed through the real resolver, so a future reader does not mistake it
for coverage of resolution behavior.

## Risks / Trade-offs

- [`resolveInstallPath` runs `existsSync` on every call, uncached] → Matches the existing code's own
  style (none of the five functions cache today); `existsSync` is cheap and these are called at
  process-start / workspace-load frequency, not per-request.
- [Refusing on ambiguity means a host that genuinely has both directories, for whatever reason,
  cannot boot until a human intervenes] → This is the explicit, deliberate point of the requirement:
  loud beats silent. No installation should ever reach this state under normal operation, since
  nothing in this change or afterward creates the new-named directory while the old one still holds
  real state — the ambiguity can only arise from a manual, out-of-band action.
- [`core` gaining a dependency on `release` is a new edge in a dependency graph the repo map
  describes precisely] → It is a leaf-to-leaf-consumer edge (`release` has zero dependencies of its
  own), so it cannot create a cycle; documented here and in the proposal's Impact section rather than
  left implicit.

## Migration Plan

None. This change makes both names readable; it does not convert an installation from one to the
other, per the ticket's explicit scope. Deploying it changes nothing observable today, because the
new name never exists on disk anywhere yet (verified by acceptance criterion 2: old-only behavior
must be byte-identical to today). No rollback plan beyond a normal revert is needed for the same
reason.
