## Context

The root test script chains with `&&`, so the UI package is never invoked on a core red. The
upgrade rollback test reads the real host `current` symlink through `currentLink()` /
`readLink()` (`packages/release/src/index.ts:18-27`) because `UpgradeDeps` stubs `switchTo` and
`build` but not the read of `current`. `stamp()` is not on this path.

`jobs.test.ts` ("lists a project's jobs newest first") does not call `currentLink()` / `stamp()`
/ `dataHome()` and did not reproduce (5/5). `engine.test.ts` ("third consecutive authentication
failure") is a different race: the test guessed one `setImmediate` after `runOnce()` before
reading the streak. Reproduced 1/5 here; fixed by waiting until the auth-failure run count is
actually 1 then 2 then 3, same `until()` pattern as `upgrade.test.ts`. Not a product change.

## Goals / Non-Goals

**Goals:**
- Both suites always run; either failure is a non-zero exit with a named suite in the output.
- The upgrade rollback test asserts the same behaviour against a fixture-owned `current`, not
  the live daemon's.

**Non-Goals:**
- Product changes to `upgrade.ts` (e.g. injecting `readCurrent`). The product should keep reading
  the real `current` symlink; the test was wrong to share the host's.
- Fixing unrelated engine/jobs flakes if they are not this coupling.
- Changing `stamp()` resolution.

## Decisions

**A small Node runner (`scripts/test.mjs`) instead of a shell `||`/`set +e` one-liner.** Same
style as `scripts/guard-*.mjs`. Sequential: print `--- core/server suite ---`, run `vitest run`,
print `--- ui suite ---`, run `pnpm --filter @agent-conductor/ui test`, then print `FAILED:
<name> suite` for each red and exit 1 if any failed. A shell `cmd1; cmd2; exit` is easy to get
wrong under zsh equals-expansion and does not label as clearly.

**Isolate `XDG_DATA_HOME` in `upgrade.test.ts`'s `beforeEach`/`afterEach`, not a new `UpgradeDeps`
seam.** Scope is test-and-tooling only. Point `XDG_DATA_HOME` at a temp dir whose
`agent-conductor/current` is a symlink to the fixture's from-release
(`/rel/20260101-120000-aaaaaaaaaa`). Restore the previous env value after. The rollback test
then expects `switches` to equal `[built path, from-release path]`.

**Considered and rejected:** unsetting `XDG_DATA_HOME` so tests hit `~/.local/share/agent-conductor`.
That is the KB workaround from 2026-09-09 and still couples the suite to a live daemon install.

## Risks / Trade-offs

- Mutating `process.env.XDG_DATA_HOME` is process-global. Vitest isolates files by default; the
  file restores the previous value in `afterEach`. No other test file reads `currentLink()` today.
