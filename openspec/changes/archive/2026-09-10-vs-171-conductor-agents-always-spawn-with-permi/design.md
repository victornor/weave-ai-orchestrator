## Context

See proposal.md for motivation.

Today `packages/core/src/runs/engine.ts` sets

`permission.mode = role.permission.mode ?? workspace.defaults.permissionMode ?? 'auto'`

for every agent. The conductor typically has no role, so it inherits
workspace default `auto`. Claude `auto` is `--permission-mode auto`; skip
permissions is only on for `bypass` (`packages/runtimes/claude/src/args.ts`).
Claude's auto-mode classifier can deny MCP tools, including `ac_*`.

Captain 2026-09-10 chose: conductor agents always spawn with bypass;
workers stay auto. Allowlisting MCP on auto was the rejected option.

## Goals / Non-Goals

**Goals:**

- Force spawn permission mode `bypass` when `agent.kind === 'conductor'`.
- Leave the worker resolution path and worker defaults untouched.
- Cover conductor-vs-worker permission in `engine.test.ts`.
- Record the exception in PLAN §10.2 and §19 so the plan matches spawn.

**Non-Goals:**

- No change to `workspace.defaults.permissionMode` (stays `auto`).
- No change to worker role YAML or hire defaults.
- No Claude adapter argv rewrite (mapping already exists).
- No MCP allowlist on auto.
- No Telegram / TUI work.
- Not launching a real coding CLI to verify.

## Decisions

### Force bypass at spawn by agent kind, not by config

One branch in the engine when building `TurnInput.permission`:

- conductor → `bypass`
- otherwise → `role.permission.mode ?? defaults.permissionMode ?? 'auto'`

Do not change the conductor role's stored permission, and do not change
the workspace default. The conductor often has no role; a stored default
could be unset. The ticket requires bypass *regardless of* workspace/role
default.

Alternative: set the conductor role to `bypass`. Rejected — no role on
the usual conductor path, and a later role `auto` would restore the bug.

Alternative: change workspace default to `bypass`. Rejected — workers
must stay auto.

Alternative: allowlist MCP tools under auto. Rejected by captain.

### Mode only; denied tools still pass through

Bypass replaces the mode, not `allowedTools` / `deniedTools`. Claude still
forwards `--disallowedTools` in bypass. PLAN §10.2's deny-list language
stays meaningful.

### Rely on existing Claude mapping

`buildArgs` already emits `--permission-mode bypassPermissions
--allow-dangerously-skip-permissions` when `permission.mode === 'bypass'`
(`packages/runtimes/claude/test/args.test.ts`). Engine test asserts
`TurnInput.permission.mode`; do not duplicate argv construction in core
(core must not import a runtime package). If the args test is still
green, the Claude conductor argv contract holds once the engine sets
bypass.

Other runtimes already declare `permissionModes: ['auto','restricted','bypass']`.
A cursor/opencode/gemini/codex conductor also gets `bypass`. Intended:
the ticket is conductor agents, not Claude only.

### Amend PLAN, do not ADR around it

PLAN §10.2 currently treats the conductor as "an agent like any other"
for runtime permission. §19 says `bypass` requires explicit human opt-in.
This change is that opt-in for the conductor kind (captain 2026-09-10).
Update those two paragraphs; do not leave a silent deviation.

## Risks / Trade-offs

- [Conductor Claude will not prompt on dangerous tools] → Accept. The
  conductor cwd is `conductor/`; hard rules forbid writing projects;
  denied tools still apply. The failure mode we are fixing is the
  classifier blocking `ac_*`.
- [A human cannot set the conductor back to auto] → Intended. Auto is
  what broke control-plane tools.
- [PLAN §19 worker bypass still needs opt-in] → Unchanged. Only the
  conductor kind is forced.

## Migration Plan

Next conductor spawn after deploy. No data migration. Rollback is revert.

## Open Questions

None.
