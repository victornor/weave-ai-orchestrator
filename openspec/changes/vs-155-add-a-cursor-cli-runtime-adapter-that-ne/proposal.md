## Why

AgentConductor can run workers and the conductor on Claude Code, Codex, OpenCode and Gemini, but not on Cursor CLI. Captain asked for Cursor as a first-class runtime on 2026-09-09. Cursor's Cloud Agent handoff (a message prefixed with `&`, pickup at cursor.com/agents) and Cursor's own `--worktree` checkouts must never be used: the daemon already owns the worktree, and a hosted Cloud Agent is a different product, out of scope.

## What Changes

- Add `packages/runtimes/cursor`, a `RuntimeAdapter` (`id: 'cursor'`) that runs turns locally through the `cursor-agent` binary (captain correction 2026-09-09: the CLI is invoked as `cursor-agent`, not `agent`).
- Register it with the daemon the same way as the existing four, so Settings and `conductor runtime` can select `cursor`.
- Turns run in the worker's existing worktree via `launchCommand('cursor-agent', …)` in print mode (`-p --output-format stream-json`), with MCP written to `.cursor/mcp.json` pointing at the run's `/mcp/runs/<runId>`.
- Mid-turn attach works the same way as Claude (VS-99 / ADR 0012): every turn keeps stdin open, the prompt is the first NDJSON `user` frame, and `TurnHandle.send` writes another frame so a human's message reaches the executing worker immediately. `streamingInput: true`. `defaults.liveInput: false` is the escape hatch. The existing `agent-attach/live-input` contract is unchanged — cursor just opts in.
- Cloud Agent handoff is forbidden: no `&` prefix on the prompt, no cloud-handoff flag, no `cursor-agent worker`, no call to cursor.com/agents. A test asserts spawn args and the prompt cannot trigger it.
- Cursor CLI's `--worktree` / `-w` / `--worktree-base` are never passed, including via `extraArgs`.
- Host credential sharing follows VS-75: symlink `auth.json` from the owner's Cursor config into the workspace runtime home; `CURSOR_CONFIG_DIR` isolates the rest.
- Verification uses a fake `cursor-agent` binary and synthetic stream-json fixtures — never the owner's live Cursor login.

## Capabilities

### New Capabilities

- `cursor-runtime/adapter`: Cursor CLI as a local `RuntimeAdapter` — detect, models, config, instructions, print-mode turns with Claude-shaped live stdin frames, MCP, sessions, credential facts — with Cloud Agent handoff and Cursor `--worktree` forbidden.

### Modified Capabilities

(none — `runtime-credentials/single-credential` already speaks of "each coding-CLI runtime" and does not name the four; cursor inherits it once registered.)

## Impact

- New package `packages/runtimes/cursor` (`adapter.ts`, `args.ts`, `events.ts`, `session.ts`, `account.ts`, `credential.ts`) plus synthetic `fixtures/` and colocated tests.
- Daemon registration: `packages/server` `RUNTIME_PACKAGES` + workspace dep; root `tsconfig.json` project reference; `scripts/guard-boundaries.mjs` forbid list.
- Credential map: `packages/core/src/workspace/loader.ts` `credentialPaths` gains a `cursor` entry.
- CLI login fallback: `packages/cli/src/commands/runtime.ts` `FALLBACK.cursor`.
- Skills install path: `skills/manifest.json` `runtimes.cursor`.
- Docs that list the shipped runtimes: `docs/PLAN.md` §8, `docs/OPERATIONS.md` credential table, `CLAUDE.md`, `docs/DOCKER.md`.
- No DB migration, no API shape change (runtimes are already a registry), Cursor is not made the workspace default.
