## Context

See `proposal.md` for motivation. The current state that shapes the approach:

- VS-610/VS-633 built provider administration at two scopes with one route factory (`packages/server/src/routes/providers.ts`), one on-disk workspace shape (`providers` and `disabledProviders` in `WorkspaceConfigSchema`), a shared pure merge (`packages/shared/src/scoped-config.ts`: `mergeScoped`, `disabledInherited`, `mergedValues`) and core wrappers (`packages/core/src/scoped.ts`: `scopedProviders`, `effectiveProviders`, `scopedSecretValue`). The same generic code serves MCP servers, which keep their per-workspace override.
- Daemon runs resolve providers through `createRuntimeHost` in `packages/server/src/daemon.ts` (`providers(workspaceId?)`, `providerKey(providerId, workspaceId?)`), reached by the `weave` adapter via `RuntimeHost`; the run engine also reads `effectiveProviders` + `scopedSecretValue` for redaction (`packages/core/src/runs/engine.ts`).
- `weave repl` (`packages/agent/src/repl/config.ts`) reads files directly and layers daemon, user, workspace and flags; it never contacts the daemon.
- `WorkspaceConfigSchema` is a non-`.strict()` `z.object`, so removing a field would silently strip a stored `providers` block on load and drop it from disk on the next config write.

## Goals / Non-Goals

**Goals:**

- One source of truth for the built-in `weave` runtime's providers and keys: `daemon.yaml` plus the daemon secret store.
- Remove the workspace provider surface end to end — nav, page, routes, client calls, run resolution and the REPL layer — leaving MCP servers untouched at both scopes.
- Never delete stored data, and never crash a workspace whose config still holds a provider block.

**Non-Goals:**

- No migration of stored workspace provider entries into `daemon.yaml` (ignored, not moved).
- No change to the provider profile schema, presets, probe/discovery code or the daemon Providers page.
- No change to MCP server scoping, routes, UI, secrets or specs.
- No removal of the generic scoped-merge helpers; MCP still needs them.

## Decisions

### D1. Retire the workspace provider override everywhere, not just its page

The ticket titles the change on the workspace Settings page, but the description contrasts providers with MCP ("MCP servers are unchanged: they stay configurable at the daemon level with optional per-workspace overrides"). Leaving the route, the daemon-run resolution or the REPL layer in place would keep the override alive behind a hidden page. So the whole concept goes: section, routes and client hooks, `createRuntimeHost` resolution, the engine's provider redaction source, and `weave repl`'s workspace provider layer. Alternatives: remove only the page (leaves dead routes and a still-effective override — rejected), or keep the routes for a future surface (rejected: no caller).

### D2. Legacy stored providers are retained in the schema and ignored, with one notice

`WorkspaceConfigSchema` keeps `providers` and `disabledProviders` so a stored block round-trips on every load and save and is never deleted; both fields are marked deprecated in the schema comment. Nothing resolves them. `loadWorkspace` (`packages/core/src/workspace/loader.ts`) inspects the parsed config and, when either field is non-empty, logs one `warn` per workspace id per process (a module-level seen-set), naming the workspace and pointing at the daemon provider settings. Alternatives: a one-time migration into `daemon.yaml` (rejected: the ticket prefers ignore and the two sets can conflict), or refusing the config (rejected: it would brick a workspace). Removing the fields was rejected because a non-strict schema would strip them and the next write would delete stored data.

### D3. The old URL redirects to the workspace settings home

`sectionFor` already falls back to a scope's first section for an unknown key, so `/settings?scope=<ws>&section=providers` renders General today. `V2Settings` additionally normalizes the URL with a replace navigation when the scope's `section` parameter is not a section of that scope, so the browser address matches the render. No 404 path is added.

### D4. Daemon resolution is daemon-only, but the host signature keeps its optional workspace id

`createRuntimeHost.providers()` and `providerKey()` resolve `deps.daemon.providers` and the daemon secret store, ignoring any workspace argument; `effectiveProviders` in core becomes the daemon set. The optional `workspaceId` on `RuntimeHost` / `RuntimeAdapter` and the engine's pass-through are retained so the `weave` adapter, engine and `listModels`/`compactSession` signatures do not churn; the spec records that the id no longer selects a profile or key. Alternative: drop the parameter across `runtime-sdk`, the adapter, the engine and the server (a wide, riskier refactor for no behaviour change) — deferred as a later cleanup.

### D5. The provider route factory becomes daemon-only

`providerRoutes` drops `workspaceScope`, the `disabled`/`setDisabled`/`disabledIds` members and the two `/:id/disable` handlers; it requires `deps.daemon` always. The daemon mount and its list/put/delete/secret/test/discover handlers are unchanged. `packages/server/src/app.ts` drops `ws.route('/providers', …)` and `routetable.ts` drops the workspace provider rows. `GET /api/w/:ws` still returns `config`, so the retained legacy fields are visible there but inert.

### D6. The UI section and provider hooks become daemon-only; MCP keeps the shared scope machinery

`V2_WORKSPACE_SECTIONS` loses the `providers` entry and `WorkspaceBody` loses its `providers` case. `ProvidersSection` drops the `scope` prop (daemon only) and the inherited/override/hide branch, `useSetProviderDisabled` is deleted, `ProviderView.source` and `ProvidersPayload.disabled` are no longer rendered, and the provider hooks drop their `scope` parameter while still resolving the daemon route. `AgentConfigScope`, `scopedCall`, `refreshAgentConfig` and the query keys stay because the MCP hooks use them; only the workspace provider query key is removed.

### D7. The REPL keeps MCP, loses providers

`loadReplConfig` no longer merges workspace `providers` / `disabledProviders`; `providersFrom` still reads `daemon.yaml` and the user's `agent.yaml`, and `resolveApiKey` drops the workspace secret store from provider-key resolution while `resolveMcpRefs` keeps it. `docs/running-the-agent-yourself.md` and the `agent-repl` spec are updated to match.

## Risks / Trade-offs

- [A stored workspace provider block is deleted by a config write] → Keep both fields in `WorkspaceConfigSchema` (D2) and cover it with a loader/route test that writes config and asserts the block survives.
- [A run silently loses its key after the workspace layer is dropped] → The daemon store is the only provider key source; the `key_missing` message and docs point at the daemon settings. The one-time loader notice tells an affected operator where the providers went.
- [Removing shared code breaks MCP] → Only provider call sites are removed; `mergeScoped`, `disabledInherited`, `scopedSecretValue`, `AgentConfigScope`, `scopedCall` and all MCP routes/UI stay, and the MCP tests are unchanged and must pass.
- [The daemon-only resolution leaves a misleading `workspaceId` parameter] → Accepted for now (D4); documented in design and noted as a follow-up cleanup, not silently.

## Migration Plan

No data migration. A workspace with a legacy provider block keeps the block on disk and runs on the daemon's providers after `weave daemon upgrade`. Rollback is a revert of the change: the schema fields are still present, so no rollback migration is needed. `weave repl` users who relied on a workspace provider move it to `daemon.yaml` or `agent.yaml`.
