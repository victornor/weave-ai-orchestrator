## Context

The provider profile schema already carries `models: Record<string, ProviderModelEntry>` with
`contextWindow`, `maxOutputTokens`, `compat` and `params`
(`packages/shared/src/config.ts`), and the runtime already merges those static models with endpoint
discovery (`packages/runtimes/weave/src/adapter.ts`, the `discover` closure). What is missing is any
way to write that map from Settings, any way to ask for discovery outside a run, and a model for the
test route to use. See `proposal.md` for the motivation.

The discovery closure is not exported: it lives inside `createAdapter`, is cached per provider, and
reads the provider key through `RuntimeHost.providerKey`. The route layer already reaches the
runtime package by specifier at call time (`loadProbe()` in
`packages/server/src/routes/providers.ts`), the same pattern this change reuses for discovery.

## Goals / Non-Goals

**Goals:**
- Edit a provider's `models` map from Settings at both scopes, with fields derived from the schema.
- Fetch a provider's model ids from its endpoint on demand, from a draft profile and an entered key.
- Make Test connection work whenever at least one model can be named, and say clearly when none can.
- Make the worker-option picker usable for the built-in runtime and honest when it is empty.

**Non-Goals:**
- Changing `ProviderProfileSchema` or any on-disk format; `models` already exists.
- Auto-discovering models in the background, or writing discovered models to the profile without an
  operator picking them.
- A full per-model `compat`/`params` form generator beyond the object fields the schema declares (a
  JSON textarea for those two, as the profile-level `compat`/`params` fields already use).
- Editing a key through the models editor; the masked key row is unchanged.

## Decisions

### One schema declaration for a model entry, one generated control

A provider model entry's fields are declared once as a JSON-Schema-shaped constant in
`packages/shared` beside `runtimeOptionProperties` (`packages/shared/src/runtime-options.ts`), and
`ProviderModelSchema` stays the validation source the route enforces. The UI renders the fields by
calling `runtimeOptionProperties(...)` on that declaration, exactly as `RuntimeOptionsEditor` does
for a runtime's `configSchema()`. Why: the ticket requires the fields to come from the schema rather
than being restated as separate inputs, and there is no existing Zod→JSON-Schema helper in the tree
and no dependency to add one. The `id` is the record key and is not a schema field, so it stays a
separate required text input. `OptionControl` is lifted into a small shared component so both the
runtime-options editor and the models editor use it; `object`-typed fields render a JSON textarea
(the model entry's `compat` and `params`), matching how the profile form already edits those.

*Alternative considered:* a hand-written row of inputs (`contextWindow`, `maxOutputTokens`, two
textareas). Rejected — the ticket asks for the schema-derived editor and it would drift from
`ProviderModelSchema`.

### Discovery is extracted from the adapter and served over a route

A reusable `listProviderModels({ profile, apiKey?, fetch? })` lives in `packages/agent` next to
`probeProvider`, returns `{ ok, models: [{ id, contextWindow? }], error? }`, and is re-exported by
`@weave-ai/runtime-weave`. The adapter's `discover` closure keeps its ten-minute cache but delegates
the request to that function, so a run and the Settings action discover through one code path. The
route is `POST /providers/:id/discover`, mounted by the same scope-parameterised handler as the
other provider routes, so it exists at both `/api/daemon/providers/:id/discover` and the workspace
route. The body is `{ profile?, apiKey? }`: `profile` lets the editor fetch against unsaved edits,
and `apiKey` (optional) lets it fetch with a key typed but not yet saved. The scope's stored key is
resolved when the body names none. The key is used only for that request — never stored, logged or
returned — and a failure is `ok: false` with a one-line reason rather than a thrown 500.

*Alternative considered:* discover through the existing test route's `models list` check. Rejected —
it discards the ids and makes five requests; discovery should be one request that returns the list.

*Alternative considered:* make the UI save the profile before discovery. Rejected — the ticket
requires it to work before the profile is saved.

### Test connection takes a model from a selector; the route keeps its shape

The route already accepts an optional `model`; only the message changes. The UI builds the selector
from the models editor's current entries plus a free-text id and sends the chosen id as `model`.
When nothing is configured and nothing is typed, the button is disabled and shows the required hint,
so the server error is a backstop rather than the normal path. The exact message is fixed by the
ticket and asserted by a route test.

### The Models picker empty state is a hint, not a change to the catalog

`ModelControls` already lists the runtime's models; the aggregate `RuntimeHost.providers()` includes
daemon providers, so a daemon-level `weave` provider's models already appear. The only gap is the
empty case: when the `weave` runtime reports no models, render a line naming the Providers settings
with a link (`/settings?section=providers`, which opens the daemon scope). No catalog field or
resolution changes.

## Risks / Trade-offs

- *The draft-profile discovery body could be mistaken for a write path.* → The route is read-only
  (it never calls `save`), is named `discover`, and the put route remains the only writer.
- *A typed key in a request body is a new secret surface.* → It mirrors the existing
  `POST /:id/secret` body; the value is used only for the call, is never persisted, and the route
  returns ids only. Tests assert no key appears in a response.
- *The shared model-entry declaration can drift from `ProviderModelSchema`.* → A shared test asserts
  the declaration's keys equal `ProviderModelSchema`'s keys, so adding a field to the schema without
  the declaration fails.
- *Discovery is a network call from a settings action.* → Ten-second timeout, a one-line failure
  reason, manual entry always available, and nothing scheduled.

## Open Questions

None.
