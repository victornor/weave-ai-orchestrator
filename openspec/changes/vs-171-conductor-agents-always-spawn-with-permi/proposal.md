## Why

Captain, 2026-09-10: another workspace's Claude conductor failed `ac_ticket_comment`
with "Permission for this action was denied by the Claude Code auto mode
classifier." Skip-permissions is only on when permission mode is `bypass`.
Workspace default is `auto` (`--permission-mode auto`), and the engine applies
that default to every agent — including the conductor. Captain chose:
conductor agents always spawn with bypass; workers stay auto.

## What Changes

- Every conductor turn's spawn permission mode is `bypass`, even when the
  workspace default and the conductor role (if any) say `auto` or anything
  else.
- Worker turns keep resolving permission mode as they do today: role, then
  workspace default, then `auto`. Worker defaults are not changed.
- On Claude, that conductor spawn includes
  `--permission-mode bypassPermissions --allow-dangerously-skip-permissions`
  (existing adapter mapping; no argv rewrite).
- PLAN §10.2 / §19 record the conductor exception so the plan matches the
  spawn.

## Capabilities

### New Capabilities

- `run-permissions/conductor-bypass`: A conductor agent's turn always
  spawns with permission mode `bypass`, regardless of workspace or role
  default. A worker's turn keeps the role/workspace mode (default `auto`).
  Claude maps `bypass` to `--permission-mode bypassPermissions
  --allow-dangerously-skip-permissions`.

### Modified Capabilities

(none)

## Impact

- `packages/core/src/runs/engine.ts` — when building `TurnInput.permission.mode`,
  force `bypass` for `agent.kind === 'conductor'`.
- `packages/core/src/runs/engine.test.ts` — conductor vs worker permission
  mode coverage (workspace default `auto`).
- `docs/PLAN.md` §10.2 and §19 — conductor always bypasses; worker `bypass`
  still needs explicit opt-in.
- Claude adapter (`packages/runtimes/claude/src/args.ts`) already maps
  `bypass`; no adapter change unless a test gap is found.
- No schema, no API, no workspace.yaml default change, no worker-role
  default change.
- Out of scope: allowlisting MCP on auto (rejected option); changing worker
  permission defaults; Telegram / TUI.
