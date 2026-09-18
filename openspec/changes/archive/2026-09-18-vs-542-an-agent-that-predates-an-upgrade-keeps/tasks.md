## 1. Tool-contract fingerprint (server)

- [x] 1.1 `packages/server/src/tool-contract.ts`'s `contractHash(defs)` hashes `{name, description, inputSchema}` sorted by name; `toolContractHash(kind, ws)` maps `toolListFor` through it. Tests in `packages/server/test/tool-contract.test.ts`: order-insensitive; a parameter added or removed changes the hash; a description-only change changes it; a workspace plugin tool changes it.
- [x] 1.2 `toolContractProvider(ws)` memoizes per kind. Same test file: it returns the same value for repeated calls and matches the computed `toolContractHash`.

## 2. Session records the contract and retires on a change (core)

- [x] 2.1 Migration `0054_session_tool_contract.sql` (`ALTER TABLE agent_sessions ADD COLUMN tool_contract TEXT`); `SessionRow.toolContract`; `create()` records it. Test: `migrations.test.ts`'s `0054_session_tool_contract (VS-542)` block — column present, a pre-0054 row is null, a new row stores the value.
- [x] 2.2 `SessionsService.forTurn(agent, policy, contract?)` retires the session (`status='stale'`) and starts a new one when the contract is supplied and differs; skips the comparison when it is omitted. Tests: `packages/core/src/sessions/sessions.test.ts` — unchanged resumes, changed retires with `stale: true`, no-contract resumes, a null recorded contract counts as different.
- [x] 2.3 `executeRun` passes `ctx.toolContractHash?.(agent.kind)`; the spawn sites in `workers/index.ts` and `sessions.reset` record it too, so a newly created session is not spuriously retired on its first turn. Tests: `engine.test.ts` — "resumes while the tool contract is unchanged" and "starts a fresh session when the tool contract changes, so the new schema is fetched (VS-542)" (the latter asserts `isFirstTurn` true, `ref` null, `systemPrompt.mode` inject on the second turn).
- [x] 2.4 Optional `toolContractHash?: (kind: AgentKind) => string` declared on `WorkspaceContext`; no existing harness needs a change. `pnpm typecheck` clean.

## 3. Wire the provider in the server

- [x] 3.1 `loadWorkspaceInto` sets `ctx.toolContractHash = toolContractProvider(runtime)` right after `loadPlugins` and before `ensureConductor`/the dispatcher. Verified by the provider test (stable per kind, moves with a plugin tool) plus `pnpm typecheck`.

## 4. Verification

- [x] 4.1 `pnpm lint && pnpm typecheck` clean.
- [x] 4.2 `pnpm test` green (with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` unset to avoid the known VS-525 worker-environment false-red in `worktrees.test.ts`): core/server 252 passed | 1 skipped (253), 3950 passed | 1 skipped (3951); UI 140 passed (140), 1775 passed (1775).
- [x] 4.3 `openspec validate vs-542-an-agent-that-predates-an-upgrade-keeps --json --strict` clean.

## 5. Delivery statement

- [x] 5.1 PR body states the mechanism chosen (targeted fingerprint retirement, not blanket upgrade retirement) and why, and records the same-way staleness finding for the rendered home instructions and installed skills with the recommended separate follow-up (a content revision in the home marker).
