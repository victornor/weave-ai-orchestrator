## Why

S3 (VS-609) made any OpenAI-compatible endpoint work by data — provider profiles in workspace config, a full `compat`/parameter surface, presets, model discovery and a `POST /providers/:id/test` probe — but the only way to add or edit a provider is to hand-edit `workspace.yaml`, and the `weave` runtime looks unconfigured on a fresh install. A human cannot configure the built-in agent's providers or pick `weave` models without YAML, and the settings copy that must tell them repository content leaves the machine is missing.

## What Changes

- A new workspace-scoped **Providers** section in `/v2/settings`: the configured providers with their base URL, preset, secret state and model count; **Add from a preset** (the daemon's preset catalogue: id, description, a suggested base URL); edit an existing profile (base URL, preset, auth, secret name, headers/query, discover, concurrency, timeouts, `compat`/`params` as JSON), and remove it.
- **Secret entry through the existing secret input** (a password field with `autoComplete="off"`, status "configured"/"not configured", never a value rendered back): setting, replacing and clearing the provider's API key in the workspace secret store under `WEAVE_LLM_<PROVIDER>_KEY`.
- **Test connection** on a saved provider: calls the existing probe, shows a per-capability verdict (auth/model list/streaming/tool calls/usage/output-cap spelling) with a **apply detected flags** action that merges the returned `detected` `compat` into the profile through the config patch.
- The **Settings copy** states that repository content is sent to whichever endpoint the user configures and that no default provider ships.
- The **worker-model catalog editor** gains the `weave` runtime for real: the model picker is fed by `listModels`, the effort picker by `RuntimeModel.efforts`, and the parameters section renders from the adapter's `configSchema()`. The existing `RuntimeOptionsEditor`/`ModelControls` already generate controls from an arbitrary schema, so they are reused; the work is to make the `weave` provider's models and options reach them and to add the per-capability validation feedback.
- Server routes to support the above, documented in `docs/API.md`: list providers (profiles + secret state + preset catalogue), upsert and delete a provider profile, set and clear a provider's secret. `POST /providers/:id/test` already exists.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `builtin-agent`: provider administration — list/upsert/delete a provider profile and set/clear its secret, with secret state readable but the value never returned.
- `web-v2/settings`: a workspace Providers section (list, add from preset, edit, secret input, test connection with apply-detected) and the `weave` runtime in the model catalog editor.

## Impact

`packages/ui/src/v2/settings` (a new `Providers.tsx` section, the section registry, the catalog editor's `weave` wiring), `packages/ui/src/api` (provider types, hooks, the client), `packages/ui/src/test` (component and route-mock tests, screenshots outside the worktree), `packages/server/src/routes/providers.ts` and `routetable.ts`, `docs/API.md`, and the design docs in the knowledge base where they change. No new dependencies. No new config schema fields. No provider or real credential is used from the ticket; live probing stays the weaver's job.
