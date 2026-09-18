# Design — a tool contract change must reach a running agent

## Findings: where the schemas come from, and when they are computed

Three layers are involved, and only one of them is stale.

1. **The daemon computes the tool list per request, from the running release.** `createMcpServer` (`packages/server/src/mcp.ts:42`) builds a short-lived MCP server for each request and answers `ListToolsRequestSchema` from `toolListFor(kind, ws, firstTurn)` (`packages/server/src/mcp.ts:43-47`), which reads the release's own `TOOLS` registry plus this workspace's plugin tools (`packages/server/src/tools.ts:1421`). Nothing caches the list on the daemon side, so after an upgrade the endpoint already serves the new schema. The incident's "a turn computes its toolset fresh at start" is true **of the daemon** — it is simply not where the stale copy lives.

2. **The daemon offers a fresh MCP endpoint every turn.** The engine mints a per-run token and writes `mcp.json` pointing at `/mcp/runs/<runId>` (`packages/core/src/runs/engine.ts:438-440`), and the claude adapter passes it with `--mcp-config --strict-mcp-config` on every turn, resumed or not (`packages/runtimes/claude/src/args.ts:84-95`). So the offer is renewed each turn; the client just does not take it up.

3. **The runtime session holds the definitions it started with.** A resumed session replays the conversation it already has, including the tool definitions from its first turn. Re-fetching inside that session returns the same stale schema, exactly as the incident recorded. This is the observed behaviour the fix has to work around; it does not matter whether the copy is the persisted transcript or the client's own MCP registry, because the remedy is the same: **stop resuming**.

**Which kinds are affected.** `sessionPolicyFor` (`packages/core/src/runs/engine.ts:215-218`) makes the weaver, planners and persistent role sessions `persistent` by design, so they cross upgrades routinely. A worker's default is `per_ticket`, but that session lasts the ticket's whole life (PLAN §7.4), so a daemon upgrade mid-ticket reaches it too — rarely noticed only because workers are short-lived. The fix is applied to every kind uniformly.

## Chosen mechanism: fingerprint the contract, retire the session that would resume under a changed one

The session cannot be made to re-read its tool list, so the only honest options are (a) retire the affected session at its next turn, or (b) retire every session on every upgrade. Option (b) is the ticket's permitted fallback but resets the weaver and every planner on every upgrade even when no tool changed, which is a real cost against PLAN §7.4's context economy. Option (a) is targeted and costs a reset only when the contract actually moved.

Implementation:

- **Fingerprint.** A new pure function `contractHash(defs)` hashes the JSON of the tool entries (name, description, inputSchema) after sorting by name, so registration order cannot move it. `toolContractHash(kind, ws)` maps `toolListFor(kind, ws)` through it. Both live beside `toolListFor` in `packages/server/src/tools.ts` (a small `packages/server/src/tool-contract.ts` keeps the import out of `daemon.ts`'s existing graph if that is cleaner).
- **Carrier.** An optional `toolContractHash?: (kind: AgentKind) => string` on `WorkspaceContext` (`packages/core/src/context.ts`). The server sets it once per workspace in `loadWorkspaceInto` (`packages/server/src/daemon.ts:261-273`) right after `loadPlugins`, memoized per kind — the value is stable for a daemon lifetime and only changes across an upgrade. This mirrors how the server already computes `v2ThemeCss` and puts it on the context (`packages/core/src/workspace/loader.ts:372`).
- **Storage.** Migration `0054_session_tool_contract.sql` adds `tool_contract TEXT` to `agent_sessions`; `SessionRow` gains `toolContract`, and `create()` records the fingerprint it was created under.
- **Decision.** `forTurn` (`packages/core/src/sessions/index.ts:56`) takes the current fingerprint as an optional third argument. When it is supplied and differs from the session's recorded value, the session is marked `stale`, a new one is created with the current fingerprint, and `stale` is returned so the turn is treated as a fresh session. When the argument is omitted (a context with no provider, all existing tests), the comparison is skipped and behaviour is unchanged.
- **Wire-up.** `executeRun` resolves `ctx.toolContractHash?.(agent.kind)` and passes it to `sessions.forTurn` (`packages/core/src/runs/engine.ts:398`).

**Why retirement, not refresh.** There is no refresh: the runtime's tool list is fixed at session start. Retirement is the mechanism the ticket's own fallback describes, made precise and cheap.

**Pre-existing sessions.** A session created before this ships has `tool_contract = NULL`, which is treated as different, so it is retired on its next turn. That is the deliberate one-time cost of not being able to prove a session current; after it, resets are targeted.

## What else is stale in the same way

- **Tool posture (allowed/denied tools, permission mode).** *Not* stale. The engine recomputes the allowlist and denylist and the adapter passes them as CLI flags on every turn (`packages/core/src/runs/engine.ts:470-490`, `packages/runtimes/claude/src/args.ts:97-118`). They are per-process, not per-session.
- **The turn prompt and the ticket/brief context.** *Not* stale; rebuilt every turn (`buildTurnPrompt`).
- **The rendered home instructions (`AGENTS.md`, `brief.md`) and the installed skills.** *Stale in the same way.* `ensureHomeCurrent` re-renders the home only when the brief revision, role spec revision or runtime changes (`packages/core/src/workers/home.ts:73-83`); it does not notice that the release's templates or `skills/` content changed. An upgrade that changes a template or a shipped skill leaves existing homes with the old copy, and the agent reads the old instructions/skill from disk. The one-time injected system prompt is also skipped on resumed turns (`packages/core/src/runs/engine.ts:497`). This is real but distinct from the tool contract, and resetting sessions for it would be wrong (it would reset on every brief change). The right fix is a content revision in the home marker that re-renders when the shipped templates or skills change; it is named here as a separate follow-up, not folded into this change.

## Alternatives considered

- **Reconnect the MCP server under a new name each turn.** Does not help: the definitions are in the session, not keyed by server name.
- **Fork the session (`--fork-session`).** Forking still replays the same tool definitions; it changes the id, not the contract.
- **Retire every session on every upgrade.** Automatic and explicit, and the ticket permits it, but it taxes every upgrade. Rejected in favour of the targeted fingerprint.
- **A hand-maintained `TOOL_CONTRACT_VERSION` bumped on schema changes.** Rejected: it depends on someone remembering, which is the class of failure being fixed.

## Test plan

- **Fingerprint unit test** (`packages/server/test/tool-contract.test.ts`): `contractHash` is stable under reordering, changes when a property is added to an input schema, and changes when only a description moves; `toolContractHash` changes when a plugin tool is added to a workspace.
- **Engine test** (`packages/core/src/runs/engine.test.ts`, next to the existing first-turn/resume test): with a stable provider the second turn resumes; with the provider changed between turns the second turn starts a new session (`session.isFirstTurn` true, `session.ref` null) and injects the system prompt. This is the test that a schema change reaches an already-running agent.
- Full `pnpm lint && pnpm typecheck && pnpm test` before delivery.

## Notes for the implementation

- Core may not import `server`; the fingerprint is computed in `server` and injected through `WorkspaceContext`, so the dependency direction holds.
- `toolContractHash` must exist for every `AgentKind`; a kind with no tools still fingerprints deterministically rather than returning undefined.
- Memoize the hash per workspace+kind so `tools/list` and the engine do not re-derive a schema on a hot path.
