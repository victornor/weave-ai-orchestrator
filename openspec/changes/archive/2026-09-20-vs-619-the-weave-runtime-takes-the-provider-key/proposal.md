## Why

The `weave` runtime reads its provider key only from the run's environment, which the engine builds from the **role's attached secrets**. A key saved in Settings > Providers (the workspace secret store, VS-610) already powers "Test connection" and model discovery, yet a real turn with the same key fails `key_missing`; and the weaver has no role, so it can never run on this runtime at all — although captain decided on 2026-09-20 that workers **and the weaver** may. The key must fall back to the run's own workspace secret store, and the lookup must never reach across workspaces.

## What Changes

- The `weave` adapter resolves the provider key as: the run environment first (a role that carries the secret still wins, keeping VS-92 host-environment precedence), then the workspace secret store via `RuntimeHost.providerKey`.
- `RuntimeHost.providers()` and `RuntimeHost.providerKey()` take an optional workspace id; `TurnInput` carries the run's workspace id. The adapter uses the run's workspace for both the profile and its key, so two workspaces defining the same provider id each use their own key. Discovery (`listModels`, `modelContextWindow`) is scoped the same way where a workspace is known.
- The `key_missing` message names both places the key can be set — Settings > Providers, or a role secret — instead of only "attach the secret to the role".
- The store-resolved key value joins the run's redaction values, so it can never appear in a transcript, event or log, exactly as a role-attached secret today.
- The key still reaches the child only on the `init` stdin line, never argv or any environment, and is stripped from the tool environment.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `builtin-agent`: the provider key may resolve from the run's own workspace secret store after the run environment, the lookup is workspace-scoped, and the store-resolved value is redacted.

## Impact

`packages/runtime-sdk/src/index.ts` (`TurnInput.workspaceId`, `RuntimeHost` signatures), `packages/runtimes/weave/src/adapter.ts`, `packages/core/src/runs/engine.ts` (workspace id into `TurnInput`, store key into redaction), `packages/server/src/daemon.ts` (workspace-scoped `providers`/`providerKey`), and the tests for each. No new dependencies, no config or API-response change, no key written anywhere new.