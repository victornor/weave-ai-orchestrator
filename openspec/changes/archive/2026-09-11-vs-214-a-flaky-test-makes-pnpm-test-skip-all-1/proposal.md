## Why

`pnpm test` is `vitest run && pnpm --filter @agent-conductor/ui test`. A red core/server run
stops the UI suite from executing at all, so a single flaky core test silently omits all 1,342 UI
tests. That is the serious half: the gate can green-light work it never checked, or red-flag work
that is actually fine.

The flake that keeps tripping the gate is
`packages/server/test/upgrade.test.ts` — "puts `current` back and fails when the runner cannot be
started". The ticket's `stamp()`-collision lead is wrong: the fixture stubs `build` to a fixed
path (`/rel/20260202-120000-bbbbbbbbbb`) and never calls `stamp()`. The test's second `switchTo`
only happens when `readLink(currentLink())` (`packages/server/src/upgrade.ts:234`) finds a host
`current` symlink. That path is `XDG_DATA_HOME/agent-conductor/current` (or
`~/.local/share/agent-conductor/current`). When the env has no such symlink — worker runtime dirs,
CI, a machine without a daemon install — `wasCurrent` is null, the rollback is skipped, and
`expect(switches).toHaveLength(2)` fails. When the host has a live `current`, it passes. Same
product code, environment-dependent result.

## What Changes

- Root `pnpm test` always runs both suites and exits non-zero if either fails. Output names which
  suite failed. Failures are not swallowed.
- `upgrade.test.ts` isolates `XDG_DATA_HOME` to a temp dir with a known `current` symlink, so the
  rollback assertion is hermetic and still checks the same behaviour (switch to the built release,
  then back to the previous current, then fail).
- No product behaviour changes. No `skip` / retry / loosened assertion.

## Capabilities

### New Capabilities
(none — test-runner and test-setup only)

### Modified Capabilities
(none)

## Impact

- Root `package.json` `test` script and a small `scripts/test.mjs` runner.
- `packages/server/test/upgrade.test.ts` fixture setup only.
- `CLAUDE.md` one-line description of `pnpm test`.
