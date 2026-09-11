## 1. Shared decision primitives (`packages/release`)

- [x] 1.1 Add `resolveInstallPath(oldPath, newPath)` to `packages/release/src/index.ts` (or a new
      `packages/release/src/paths.ts` re-exported from it), returning the non-throwing
      `{status:'old'|'new'|'fresh', path}` / `{status:'ambiguous', oldPath, newPath}` union from
      design.md Decision 1; verify with a unit test covering all four outcomes against a temp
      directory.
- [x] 1.2 Add `resolveWorkspaceStateDir(root)` to the same file per design.md Decision 3, built on
      `resolveInstallPath` with the two candidate `db.sqlite` paths, throwing a plain `Error` naming
      both paths on ambiguous. Verify with a unit test covering old/new/fresh/ambiguous against a temp
      workspace root.

## 2. User-level directories (`packages/release`)

- [x] 2.1 Rewrite `dataHome()` to resolve `<base>/agent-conductor` vs `<base>/weave` through
      `resolveInstallPath`, throwing a plain `Error` naming both paths on `ambiguous`; `releasesDir()`/
      `currentLink()`/`previousLink()` are unchanged (still built on `dataHome()`'s return). Verify with
      a test per scenario: old-only, new-only, neither (fresh → `weave`), both (throws, message names
      both paths).
- [x] 2.2 Add `configDir()` to `packages/release`, resolving `<base>/agent-conductor` vs
      `<base>/weave` the same way (explicit `AC_CONFIG_HOME` override still bypasses resolution
      entirely and returns verbatim, checked first). Verify with the same four-scenario test shape as
      2.1, plus a case asserting the override path is never even passed to `resolveInstallPath`.
- [x] 2.3 Add `stateHome()` to `packages/release`, same resolution shape, no explicit-override case
      (none exists for state today). Verify with the same four-scenario test shape.
- [x] 2.4 Update `packages/core/src/workspace/loader.ts`'s `configDir()` to call
      `@agent-conductor/release`'s `configDir()` instead of its own literal; delete the local
      duplicate. Add `@agent-conductor/release` to `packages/core/package.json` dependencies. Verify
      `pnpm typecheck` and existing `loader.test.ts` (or equivalent) still pass unmodified.
- [x] 2.5 Update `packages/cli/src/contexts.ts`'s `configHome()`/`stateHome()` to call through to
      `@agent-conductor/release`'s new `configDir()`/`stateHome()` (keeping the existing exported
      names `configHome`/`stateHome` at this file's call sites, since renaming them is out of scope);
      delete the local literals. Verify `pnpm typecheck` and existing CLI tests referencing these
      functions still pass unmodified.

## 3. `isDefaultConfigDir` recognizes both plain defaults

- [x] 3.1 Rewrite `plainDefaultConfigDir`/`isDefaultConfigDir` in
      `packages/core/src/workspace/loader.ts` per design.md Decision 5: `isDefaultConfigDir(resolved)`
      returns true when `resolved` equals either the old-named or the new-named plain default,
      compared directly (not through `resolveInstallPath`). Verify with a test asserting the isolation
      comparison still returns a definite answer even when both plain-default directories exist on
      disk simultaneously (the scenario design.md calls out).
- [x] 3.2 Verify `packages/server/src/daemon.ts`'s `resolveIsolation()` (which calls
      `isDefaultConfigDir`) needs no changes itself — confirm by reading it, not by assumption — and
      that its existing tests still pass.

## 4. Per-workspace directories (`packages/core/src/context.ts`)

- [x] 4.1 Add the `ambiguous_install_path` error code to `packages/shared/src/errors.ts`'s
      `ERROR_CODES` (and an explicit `OcError.status` mapping, e.g. 500). Verify
      `packages/shared/src/errors.ts`'s existing type tests still compile and a new case is covered if
      such a test exists.
- [x] 4.2 Rewrite `workspacePaths(root)` per design.md Decision 3 to call `resolveWorkspaceStateDir()`
      (task 1.2) and build the `state`/`conductor` fields together from its answer (old →
      `.agent-conductor`/`conductor`, new or fresh → `.weave`/`weaver`), wrapping the plain `Error` it
      throws into `OcError('ambiguous_install_path', ...)` with both candidate `db.sqlite` paths in
      `details`. Every other field on `WorkspacePaths` keeps today's shape, just under the resolved
      segment name.
- [x] 4.3 Verify with a test reproducing the exact shape acceptance criterion 6 names: a workspace
      root with only `.agent-conductor/db.sqlite` present resolves as an existing installation (not
      fresh), with `state`/`conductor` both under the old name.
- [x] 4.4 Verify with a test for the both-exist case: `db.sqlite` present under both
      `.agent-conductor` and `.weave` for the same root throws `ambiguous_install_path`, and confirm
      (by asserting on a spy or the absence of a new `db.sqlite`) that no database is opened or
      created as a result.
- [x] 4.5 Verify with a test for the fresh case: neither directory exists, `workspacePaths()` resolves
      `.weave`/`weaver`.
- [x] 4.6 Fix `initWorkspace()`'s `.agent-conductor/.gitignore` literal (design.md Decision 8) to use
      `workspacePaths(root).state` instead of the hardcoded segment. Verify the existing
      `initWorkspace` test (or a new assertion) checks the gitignore lands under the resolved state
      directory, not a hardcoded one.

## 5. Other consumers that rebuilt a workspace path instead of asking the resolver

Found during plan review by grepping the whole repo, not only the files already touched — see
design.md Decision 4.

- [x] 5.1 `packages/server/src/upgrade.ts`'s `backupDatabases()`: replace
      `join(w.path, '.agent-conductor', 'db.sqlite')` with `resolveWorkspaceStateDir(w.path).stateDir`
      joined with `db.sqlite`. Verify with a test: a registered workspace resolved to the new name is
      backed up (not silently skipped, the current bug for anything but the old name), and an
      ambiguous workspace throws rather than being silently skipped or backed up from the wrong side.
- [x] 5.2 `packages/cli/src/commands/daemon.ts`'s independent copy of `backupDatabases()`: the same
      fix as 5.1, in this file's own copy (it does not share an implementation with 5.1's — both are
      real, independently maintained functions; this ticket fixes the path literal in each, not the
      pre-existing duplication between them, which is out of scope). Verify with the same test shape
      as 5.1, run against this file's function.
- [x] 5.3 `packages/cli/src/commands/runtime.ts`'s `runtime login`: replace
      `join(root, '.agent-conductor', 'runtimes', id)` with
      `join(resolveWorkspaceStateDir(root).stateDir, 'runtimes', id)`. Verify with a test: a workspace
      resolved to the new name produces a `configHome` under `.weave/runtimes/<id>`, not the old
      literal.
- [x] 5.4 Add a one-line comment at `packages/server/test/fakes.ts:341`'s hardcoded
      `state: '/tmp/ws/.agent-conductor'` noting it is a synthetic double never routed through
      `workspacePaths()`/`resolveWorkspaceStateDir()`, per design.md Decision 9. No behavioral change
      to the fake.

## 6. Whole-layer regression check

- [x] 6.1 With only old-named directories present (the state of every workspace running today),
      confirm end-to-end that a workspace loads, its conductor agent's home resolves correctly, and no
      behavior differs from before this change — this is acceptance criterion 2's byte-identical
      claim; write it as an explicit test, not an inference from the unit tests above.
- [x] 6.2 Grep the **whole repository** (not only the packages this change touched — that scoping is
      exactly how the three consumers in §5 were missed the first time) for the literal
      `'agent-conductor'` as a path segment outside the files this change collapsed it into, and for
      `'.weave'`/`'weaver'` similarly, confirming acceptance criterion 1 (no family spelled in more
      than one place) by direct search, not by memory of what was changed. Record the exact grep
      command and its (empty, modulo tests and the fakes.ts comment) output in the delivery report.
- [x] 6.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (both suites — core/server and UI) and
      record both blocks verbatim with their real totals in the delivery report, per this project's
      standing convention.
