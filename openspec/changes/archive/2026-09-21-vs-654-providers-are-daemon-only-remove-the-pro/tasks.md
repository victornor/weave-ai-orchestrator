## 1. Shared and core

- [x] 1.1 Keep `providers` and `disabledProviders` in `WorkspaceConfigSchema` (`packages/shared/src/config.ts`), mark both deprecated in the schema comment, and confirm a workspace config carrying a legacy block still parses. Verify: `pnpm vitest run packages/shared/src/config.test.ts` is green with a case asserting the block parses.
- [x] 1.2 Make provider resolution daemon-only in `packages/core/src/scoped.ts` (`effectiveProviders` returns the daemon's set; drop `scopedProviders` if it has no caller), and point the engine's provider redaction (`packages/core/src/runs/engine.ts`) at the daemon providers and daemon secret store, keeping `scopedSecretValue` for MCP. Verify: `pnpm vitest run packages/core/src/runs/engine.test.ts` is green.
- [x] 1.3 In `packages/core/src/workspace/loader.ts`, retain the legacy fields on every save and log one notice per workspace id per process when either is non-empty. Verify: `pnpm vitest run packages/core/src/workspace/loader.test.ts` covers load, save-preserves-the-block and notice-once.

## 2. Server

- [x] 2.1 Make `packages/server/src/routes/providers.ts` daemon-only: remove `workspaceScope`, `disabled`/`setDisabled`/`disabledIds` and the two `/:id/disable` handlers; keep list, put, delete, secret, test and discover. Verify: `pnpm vitest run packages/server/test/providers-route.test.ts` is green.
- [x] 2.2 Remove the workspace provider mount and rows: `packages/server/src/app.ts` drops `ws.route('/providers', …)` and `packages/server/src/routetable.ts` drops the workspace provider rows. Verify: a request to `/api/w/:ws/providers` is 404 in `packages/server/test/providers-route.test.ts`.
- [x] 2.3 Make `createRuntimeHost` (`packages/server/src/daemon.ts`) resolve `providers` and `providerKey` from the daemon set and daemon store, ignoring any workspace argument. Verify: `pnpm vitest run packages/server/test/runtime-provider-scope.test.ts` asserts a workspace's provider block does not change the resolved profile or key.
- [x] 2.4 Confirm `GET /api/w/:ws` still returns the retained `providers`/`disabledProviders` fields from config. Verify: the workspace route test asserts they are present and inert.

## 3. UI

- [x] 3.1 Remove the workspace Providers entry from `V2_WORKSPACE_SECTIONS` and its `WorkspaceBody` case (`packages/ui/src/v2/settings/sections.ts`, `V2Settings.tsx`), and normalize a stale `section=providers` URL to the scope's first section with a replace navigation. Verify: `pnpm vitest run packages/ui/src/test/v2settingsSections.test.ts packages/ui/src/test/v2settings.test.tsx` is green.
- [x] 3.2 Reduce `packages/ui/src/v2/settings/sections/Providers.tsx` to the daemon section: drop the `scope` prop, the inherited/override/hide branch and the disabled list. Verify: `pnpm vitest run packages/ui/src/test/v2providers.test.tsx` renders the daemon section and no workspace controls.
- [x] 3.3 Make the provider hooks daemon-only (`packages/ui/src/api/hooks.ts`), remove `useSetProviderDisabled`, the workspace provider query key (`api/keys.ts`) and `ProvidersPayload.disabled` (`api/types.ts`), keeping `AgentConfigScope`, `scopedCall` and `refreshAgentConfig` for MCP. Verify: `pnpm vitest run packages/ui/src/test/v2agentscopes.test.tsx` is green with the workspace-provider cases removed.
- [x] 3.4 Confirm the empty built-in-agent catalog link in `packages/ui/src/v2/settings/sections/Models.tsx` points at the daemon Providers section. Verify: `pnpm vitest run packages/ui/src/test/v2settings.test.tsx` asserts the link target.

## 4. Terminal agent

- [x] 4.1 Drop the workspace `providers` / `disabledProviders` layer from `packages/agent/src/repl/config.ts` (keep the workspace `mcpServers` layer and the workspace secret store for MCP references). Verify: `pnpm vitest run packages/agent/src/repl/config.test.ts` asserts a workspace provider is ignored and a workspace MCP server is still read.
- [x] 4.2 Update `docs/running-the-agent-yourself.md` to say providers come from `daemon.yaml`, the user's `agent.yaml` and flags, while MCP servers keep their workspace layer. Verify: the precedence table in the doc names no workspace provider source.

## 5. Documentation

- [x] 5.1 Update `docs/API.md`: remove the workspace Providers route block, drop the `disabled`/`source` workspace-provider wording, and keep the daemon Providers block and the MCP blocks unchanged. Verify: `grep -n "/providers" docs/API.md` shows only daemon provider routes and the MCP section.
- [x] 5.2 Check `README.md`, `docs/PLAN.md` and the remaining specs for workspace-provider text and leave MCP text intact. Verify: `openspec validate --strict` and the doc greps are clean.

## 6. Tests and delivery

- [x] 6.1 Iterate the changed test files until green (`providers-route`, `runtime-provider-scope`, `v2providers`, `v2agentscopes`, `v2settings*`, `engine`, `loader`, `config` shared and agent, `scoped-config`). Verify: each run passes.
- [x] 6.2 Run one full suite at the end with `VITEST_MAX_WORKERS=4 pnpm test`, paste both suite blocks verbatim. Verify: both blocks are green.
- [x] 6.3 Capture the workspace settings nav in light and dark themes, save them outside `work/` in the agent home, and attach both to VS-654. Verify: the ticket's approval card shows both captures and `git status --porcelain` is empty before review.
