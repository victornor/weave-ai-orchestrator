## Why

An agent's runtime session fixes the tool definitions it holds when the session starts, and `--resume` replays that conversation rather than re-reading the daemon's tool list. The daemon, meanwhile, computes the MCP tool list fresh on every `tools/list` request. So after an upgrade that changes a tool's parameters, a long-lived session (the weaver, a planner, a persistent role session, or a worker whose ticket spans the upgrade) keeps calling the old schema and the new parameter is unreachable until somebody restarts that agent by hand. This is live right now: VS-504 added `weave_decision_answer`'s `inputs` parameter, it shipped and the daemon runs it, but the weaver's session predates the upgrade, so two decisions were unanswerable tonight and the incident reads as the agent doing it wrong rather than the platform withholding a shipped capability.

## What Changes

- The daemon computes a **tool-contract fingerprint** for each agent kind — a hash of the tool names, descriptions and input schemas that kind's `tools/list` would return, plugin tools included.
- Each agent session records the fingerprint it was started under. Before a turn spawns, the engine compares the recorded fingerprint to the current one. When they differ, it **retires the session and starts a new one**, so the runtime fetches the current tool list; it does not ask the agent and it needs no human.
- A session that predates this feature (no recorded fingerprint) is treated as different and starts fresh on its next turn, because it cannot be proven current.
- The delivery states what else is captured at session start — the rendered home instructions and installed skills — and whether it is stale in the same way (it is; see design.md), with that left as a named, separate follow-up rather than fixed here.

## Capabilities

### New Capabilities
- `session-tool-contract`: a session's tool contract is revalidated before each turn, and a session that would resume under a changed contract is retired so the shipped tool definitions take effect.

### Modified Capabilities
<!-- None: the affected session lifecycle requirements are introduced by this change, not changed from an existing spec. -->

## Impact

- `packages/core/src/sessions/index.ts` — fingerprint comparison and retirement in `forTurn`; `agent_sessions.tool_contract`.
- `packages/core/src/runs/engine.ts` — resolve the current fingerprint and pass it into `forTurn`.
- `packages/core/src/context.ts` — an optional, server-provided `toolContractHash(kind)` on `WorkspaceContext`.
- `packages/server/src/tools.ts` (or a small sibling module) — the fingerprint function over `toolListFor`.
- `packages/server/src/daemon.ts` — wire the provider onto each loaded workspace after plugins load.
- `packages/db/src/migrations/0054_session_tool_contract.sql` — the new column.
- Tests: fingerprint sensitivity to a schema change; an engine test that a changed contract starts a fresh session and an unchanged one resumes.
