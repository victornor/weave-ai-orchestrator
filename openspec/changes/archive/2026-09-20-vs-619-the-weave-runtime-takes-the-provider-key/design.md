## Context

See `proposal.md` — Why. Current state, on `main` at 436bfa6c:

- `packages/runtimes/weave/src/adapter.ts` reads the key as `input.env[keyVar]` and fails `key_missing` when absent. `input.env` is built by `roleSecretsEnv` in `packages/core/src/runs/engine.ts` from the role's attached secrets only — so a run with no role (the weaver) has nothing, and a key saved in Settings > Providers is ignored.
- `RuntimeHost` (`packages/runtime-sdk/src/index.ts`) exposes `providers()` and `providerKey(providerId)`. The daemon's wiring in `packages/server/src/daemon.ts` aggregates every workspace's providers with first-wins across workspaces, and `providerKey` returns the first workspace that defines the id — so a second workspace defining the same id can run with the first workspace's profile and key.
- `TurnInput` carries no workspace, so the adapter cannot ask for a specific workspace's provider.
- The engine redacts the run token and the role secrets' values (`makeRedactor`); a store-resolved provider key is not among them.

The provider schema (VS-609) and the workspace secret store (VS-610) already exist; this change only changes where the key is read from and which workspace it is read for.

## Goals / Non-Goals

**Goals:**
- A run with no role (the weaver) completes on a provider whose key lives in the run workspace's secret store.
- A role-attached secret still wins, and the host's own environment keeps its precedence.
- Profile and key are always the run's own workspace's; a workspace with no such provider id fails rather than borrowing another's.
- The store-resolved key is redacted like a role secret.

**Non-Goals:**
- No change to how secrets are stored, named or attached to roles (VS-610 owns that).
- No change to host-environment precedence (VS-92).
- No new provider config fields, no cost/pricing work.
- No change to the `init` protocol: the key still travels only on the stdin `init` line.

## Decisions

**1. Resolve in the adapter, environment first then the host.** `apiKey = (keyVar ? input.env[keyVar] : undefined) ?? host?.providerKey?.(providerId, input.workspaceId)`. Alternative — have the engine inject the store key into `input.env` beside the role secrets — is rejected: the ticket asks for the `RuntimeHost.providerKey` fallback, and the same lookup must also serve discovery, which has no run and no `input.env`.

**2. Additive optional `workspaceId` on `TurnInput`, optional workspace argument on the host methods.** `RuntimeHost.providers(workspaceId?)` and `providerKey(providerId, workspaceId?)`. With a workspace id, the daemon resolves that workspace's providers/profile only; without one (the daemon's runtime catalog, `detect()`) it keeps today's aggregate behaviour. Alternative — a required argument — is rejected because callers with no run (`detect`, the root catalog) genuinely have no workspace, and forcing one would invent it. `input.workspaceId` is the engine's `ctx.workspaceId`.

**3. Scope discovery too.** `RuntimeAdapter.listModels(workspaceId?)` and `modelContextWindow(model, workspaceId?)` gain the optional argument (source-compatible: an implementation with fewer parameters still satisfies the type). The `weave` adapter threads it into `discover()` → `providers()`/`providerKey()`. The root `GET /runtimes/:id/models` route accepts an optional `?workspace=`, resolved through `deps.workspaces` (slug or id); the web hook `useRuntimeModels` takes the workspace its page already holds (`run.workspaceId`, `cell.ws`) and passes it. The dispatcher's model-window cache passes `ctx.workspaceId`, since it is a workspace-scoped caller. Alternative — leave discovery aggregate — is rejected: a second workspace defining the same provider id would otherwise list and authenticate against the first workspace's endpoint in the Models editor, which is the same cross-workspace leak this ticket removes from the run.

**4. Redact in the engine.** After `roleSecretsEnv`, the engine resolves the run's model provider id (the prefix before `/` in `setting.model`), looks up `ctx.config.providers[id].apiKeySecret` in the run's own workspace, and appends the stored value to `redactionSecrets`. Alternative — redact in the adapter — is rejected: the adapter never sees the redactor and does not own events, transcripts or logs. The engine and the adapter read the same workspace store in the same turn, so the two lookups agree; the engine's lookup exists only to seed redaction, never to pass the key to the child.

**5. The `key_missing` message names both places.** `The provider key <VAR> is not set: add it under Settings > Providers, or attach the secret to the role.` Family stays `auth`, code stays `key_missing`.

## Risks / Trade-offs

- **Two lookups could diverge** if the store changes between the engine's redaction lookup and the adapter's run lookup → both run within one `executeRun` and read the same encrypted file; a change mid-turn is not a supported operation. The adapter's value is what the child uses; the engine redacts the stored value, and both come from the same secret name.
- **A workspace id the daemon cannot resolve** would otherwise silently fall back to another workspace → the host returns no provider for it, and the adapter fails `provider_not_configured`. Covered by a test.
- **Key shorter than `makeRedactor`'s 8-character floor** is not redacted — pre-existing behaviour, unchanged here.
- **Signature growth on the SDK** → all new parameters are optional, so existing adapters and test fakes compile unchanged; only the `weave` adapter and the daemon host read them.
