## Why

The Usage view has shown no Claude plan limits since VS-34 landed on 2026-09-05. The stored
snapshot for `claude` is `billing_type = unknown`, `limits_available = 0`, with the note
`claude: the get_usage probe returned no control response (exit -1: spawn error)` — so the 5-minute
sweep runs, and every sweep fails the same way.

The cause is the environment the probe spawns with, not the CLI, the credentials or the control
request. `accounts.refresh()` calls `describeAccount({ configHome, env: {}, … })`
(`packages/core/src/usage/accounts.ts:73`) and `probeAccount` passes that empty overlay straight to
`spawnLines` as the child's whole environment (`packages/runtimes/claude/src/account.ts`). A child
with no `PATH` falls back to `/bin:/usr/bin` inside `execvp`, and the CLI is not there: the daemon
runs under a systemd user unit, and `claude` is a mise install under the user's home. `spawn` emits
`ENOENT`, `spawnLines` resolves that as `exitCode: -1` with `spawn error` on stderr, and the note
above is written.

A worker turn spawns the same binary all day because `runTurn` merges the daemon's own environment
first: `env: { ...process.env, ...built.env }` (`packages/runtimes/claude/src/adapter.ts`). Two
spawn paths for one CLI, only one of which inherits an environment, is the defect.

Because the account is never classified, every run is recorded `billing_type = unknown`, `showCost`
keeps the dollar view, and the plan block reads as an ordinary account with no limits — the failure
is invisible unless someone reads the database.

## What Changes

- **One launcher for every spawn of a coding CLI.** A `launchCommand()` in `runtime-sdk` resolves
  the command to an executable and builds the child's environment from the daemon's own with the
  adapter's overlay on top. The claude turn path and the account probe both go through it, so the
  probe cannot resolve differently from the turn beside it.
- **Resolution does not depend on the parent shell.** The command is looked up on the effective
  `PATH` and then in the directories the usual installers use (mise shims, `~/.local/bin`, bun,
  volta, npm prefix, `/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin`, `/bin`), and spawned by
  absolute path. A command that carries a path already is left alone, and one that is nowhere is
  passed through unchanged so the spawn still fails with the runtime's own error.
- **A failed probe is legible.** The description carries how the probe was launched — the resolved
  command, the cwd and the directories searched — and the daemon logs that at `warn` whenever an
  account comes back `unknown`. The detail is logged, never stored and never shown.
- **The view distinguishes a failed probe from a plan without windows.** Where the account could not
  be described at all, the web usage view and `conductor usage` say the account probe failed and
  give the stored note and the capture time, instead of the same "limits unavailable" line an
  account with genuinely no windows gets.
- **The view says why a dollar figure survived.** When a window mixes subscription tokens with
  metered or unclassified ones, both surfaces state that cost is still shown for that reason — the
  rule VS-34 chose, now written down where it is applied. Rows recorded before this fix stay
  `unknown` and are not backfilled.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `usage-plan-limits`: how the account probe launches the runtime CLI, and what the usage view and
  `conductor usage` show when a probe fails or a window mixes billing types.

## Impact

- `packages/runtime-sdk/src/launch.ts` (new) — `launchCommand`, `childEnv`, `fallbackBinDirs`.
- `packages/runtime-sdk/src/index.ts` — exports the launcher; `AccountDescription` gains an optional
  `diagnostics` map that is logged, not persisted.
- `packages/runtimes/claude/src/account.ts`, `packages/runtimes/claude/src/adapter.ts` — the probe
  and the turn both launch through it.
- `packages/core/src/usage/accounts.ts` — a `warn` with the launch detail when a probe fails.
- `packages/render/src/usage.ts`, `packages/render/src/types.ts` — `probeFailed` on the limits view
  model, and `mixedBillingNote()` shared by both surfaces.
- `packages/ui/src/components/PlanLimits.tsx`, `packages/ui/src/routes/Usage.tsx`,
  `packages/cli/src/commands/usage.ts` — the two new lines.
- No schema change, no migration, no HTTP surface change.

## Out of scope

- Claude's extra-usage spend fields, excluded by VS-34's design.
- The codex, gemini and opencode probes, which read credential files and do not spawn a CLI.
- Backfilling the billing type of usage rows recorded before the fix.
