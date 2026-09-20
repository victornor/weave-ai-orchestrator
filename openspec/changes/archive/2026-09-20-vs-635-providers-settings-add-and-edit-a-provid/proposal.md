## Why

Captain cannot finish setting up a provider (the `codeify` endpoint added right after VS-633): the
Providers page has no way to enter a model, so Test connection fails with
`name a model to test: provider codeify lists none` and the provider cannot be named by a worker
option. An endpoint that is not queried for discovery, or a fresh provider, can therefore never be
tested or used.

## What Changes

- **A models editor on every provider**, at both the daemon scope and a workspace override: list,
  add, edit and remove model entries. Each entry has a required id and the fields the provider
  model schema declares (`contextWindow`, `maxOutputTokens`, `compat`, `params`), rendered from a
  shared schema declaration rather than hand-coded per field. Saving writes them into
  `profile.models` through the existing put route.
- **Fetch from endpoint.** A new on-demand discovery route plus a UI action that calls the
  provider's model discovery (`GET {baseUrl}{modelsPath}`) with the profile's preset, compat,
  headers, query and the stored key, and the default agent User-Agent. It returns the ids (with a
  context window where the endpoint reports one); picking one adds it to the models list. It works
  against the draft profile before the profile is saved, and against a key entered but not yet saved.
  A failure returns a one-line reason and leaves manual entry available.
- **Test connection takes a model.** Next to the button, a selector: the provider's configured
  models plus a free-text id. The chosen id is sent as `asked`. With no models configured and none
  typed, the button is disabled with the hint "add or type a model to test" instead of failing.
- **The error message says what to do.** If the route is still called with no model and the provider
  lists none, it reads `provider <id> has no models; add one on the Providers page or pass a model to
  test`.
- **Worker options pick a provider's models.** The Models section's picker for the built-in `weave`
  runtime lists the provider models configured at daemon level; when the runtime reports none it
  says so and links to the Providers page.
- Keys stay write-only exactly as today: nothing renders a stored value.

## Capabilities

### New Capabilities
<!-- none: this extends existing provider and model-selection behaviour -->

### Modified Capabilities
- `builtin-agent`: the `POST /providers/:id/test` requirement gains a required model and the new
  no-model message; a new requirement covers on-demand model discovery through the runtime's own
  discovery code.
- `agent-config-scopes`: provider administration at both scopes gains a models editor and endpoint
  discovery, so a daemon provider or a workspace override can be given models.
- `model-selection/worker-options`: the worker-option model picker names the empty case for the
  built-in runtime and points at the Providers page.

## Impact

`packages/shared` (a schema declaration for provider model entry fields), `packages/agent`
(reusable provider-model discovery), `packages/runtimes/weave` (re-export and use it),
`packages/server` (discover route, test-route message, routetable, `docs/API.md`), `packages/ui`
(Providers models editor + fetch + test selector, Models picker empty state, hooks and types),
tests and the user docs. No schema or on-disk format change; a provider's `models` already exists in
`ProviderProfileSchema`.
