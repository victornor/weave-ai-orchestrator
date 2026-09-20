## 1. SDK: a workspace-aware provider lookup

- [x] 1.1 `TurnInput.workspaceId?: string` — the run's own workspace — and `RuntimeHost.providers(workspaceId?)` / `providerKey(providerId, workspaceId?)`, documented: with an id, that workspace's providers only; without one, today's aggregate. Existing adapters and test fakes compile unchanged.
- [x] 1.2 Optional workspace argument on `RuntimeAdapter.listModels(workspaceId?)` and `modelContextWindow(model, workspaceId?)` (source-compatible; an implementation with fewer parameters still satisfies the type).

## 2. The `weave` adapter

- [x] 2.1 `runTurn` resolves the profile from `providers(input.workspaceId)` and the key as `input.env[keyVar] ?? host.providerKey(providerId, input.workspaceId)`; `key_missing` message names Settings > Providers and a role secret.
- [x] 2.2 `discover(pid, profile, workspaceId?)` takes the workspace and passes it to `providers()`/`providerKey()`; `listModels(workspaceId?)` and `modelContextWindow(model, workspaceId?)` thread it through, both cache-keyed so one workspace's result never serves another's.
- [x] 2.3 Adapter tests through the fake child: a role-less run with the key only in the workspace store completes; a role-attached secret still wins; two workspaces defining the same provider id each get their own profile and key; the store key is absent from child argv, child environment and the tool environment; the `key_missing` message names both places; discovery for one workspace uses that workspace's key.

## 3. The run engine

- [x] 3.1 Build `TurnInput` with `workspaceId: ctx.workspaceId`.
- [x] 3.2 Resolve the run's model provider id from `setting.model` and, when that provider's `apiKeySecret` has a value in the run workspace's store, append it to `redactionSecrets` beside the run token and role secrets.
- [x] 3.3 Engine tests: the executed turn's input carries the workspace id; a turn whose output echoes the store-resolved provider key records `[redacted]`, not the key.

## 4. The daemon and the discovery surface

- [x] 4.1 Extract the runtime host into an exported, testable lookup scoped by workspace: `providers(workspaceId?)` and `providerKey(providerId, workspaceId?)` resolve that workspace's config and secret only, and a named-but-unknown workspace resolves nothing rather than another workspace's provider.
- [x] 4.2 `GET /runtimes/:id/models` accepts an optional `?workspace=` (slug or id, resolved through the daemon's workspaces) and passes it to `listModels`; `docs/API.md` records it.
- [x] 4.3 `useRuntimeModels(runtimeId, workspace?)` sends the workspace and includes it in the query key; the pages that already hold a workspace — run page, live tiles, plan tab, chat, settings — pass it; UI tests updated.
- [x] 4.4 The dispatcher's model-window cache passes `ctx.workspaceId` to `modelContextWindow`.
- [x] 4.5 Server tests: the models route passes the given workspace to the adapter and 404s an unknown one; the extracted host resolves two workspaces defining the same provider id to their own profile and key.

## 5. Verification

- [x] 5.1 `pnpm lint && pnpm typecheck` green.
- [x] 5.2 Each full suite once with `--maxWorkers=4` (core/server, then UI); both blocks pasted verbatim in the PR.
