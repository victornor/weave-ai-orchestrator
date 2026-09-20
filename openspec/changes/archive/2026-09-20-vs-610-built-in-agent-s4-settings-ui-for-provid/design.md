## Context

See `proposal.md` — Why. S3 (VS-609) put provider profiles in workspace config (`providers:` in
`workspace.yaml`), gave the `weave` adapter a full `configSchema()` of sampling parameters, model
discovery through `listModels` and effort levels on `RuntimeModel.efforts`, and one route,
`POST /providers/:id/test`. The V2 Settings screen (`packages/ui/src/v2/settings`) already has a
two-level scope/section registry and a Models editor whose generated controls read an adapter's
`configSchema()` (`RuntimeOptionsEditor`) and its model list (`useRuntimeModels` →
`GET /runtimes/:id/models`). There is no way to read or write providers or their keys from a client;
workspace config carries no secret (`daemon.ts` resolves `profile.apiKeySecret` through
`ws.services.secrets`), and the Telegram token route is the existing model for a secret write path.

## Goals / Non-Goals

**Goals:**
- Add and edit providers and their keys without YAML, from the workspace scope of Settings.
- Keep the secret value out of every config file, response, log, event and rendered output.
- Reuse the existing generated model/options editor for the `weave` runtime instead of a parallel one.
- A probe result a human can read, with the measured flags one click from being applied.

**Non-Goals:**
- No live provider call or real credential from this ticket; the weaver runs the live probes.
- No pricing or cost display (S3 dropped it; this slice does not add it back).
- Not daemon-wide providers (they are workspace config) and not the weaver's runtime choice.
- Not the conformance runner or probe internals — S3 built them; this slice only calls the route.

## Decisions

**1. Provider administration gets its own `/providers` route group, not `PATCH /config`.**
`GET /providers` returns a resolved view the raw config cannot carry — each profile plus whether its
secret is set, and the preset catalogue. `PUT /providers/:id` and `DELETE /providers/:id` write the
profile. `PATCH /config` remains the generic escape hatch and is not the UI's provider write path.
Alternative: reuse `PATCH /config` for profiles and read `GET /workspace` for the list. Rejected: the
list would still need a second call for secret state and model ids, and a profile write would sit next
to the config blob where the secret boundary is easy to cross by accident.

**2. The key rides its own route into the workspace secret store.** `POST /providers/:id/secret`
registers the value under the profile's `apiKeySecret`; `DELETE /providers/:id/secret` clears it.
This mirrors `POST /channels/telegram/token` (`routes/channels.ts`): the route calls
`ws.services.secrets.put/clear` directly, returns only a status, and the secret never reaches
`workspace.yaml` or a config response. A provider whose `apiKeySecret` is unset refuses a key. The
new-provider flow defaults the secret name to `WEAVE_LLM_<PROVIDER_ID>_KEY`, chosen so it cannot
collide with a production variable a project's compose file already names. Alternative: accept the
key inside `PUT /providers/:id`. Rejected: it would land in the config write path and in the config
response.

**3. The preset catalogue is served by the daemon; the base-URL hint lives in the UI.**
`@weave-ai/runtime-weave` re-exports the agent package's `PRESET_NAMES` and `loadPreset` (additive,
one line; the package already re-exports `probeProvider` from the same module). The provider route
composes `{ id, description }` for each name through the same lazy by-specifier import the test route
uses, so the list can never drift from the runtime's own presets. The suggested base URL per preset
(the presets carry compat flags and a description, not an endpoint) is a small UI map, because it is
presentation data that does not affect a turn. Alternative: add `baseUrl` to each preset JSON and the
agent `Preset` type. Rejected for scope: it touches the agent package's data and loader for a value
only the add form uses, and the presets are already `verified` S3 assets.

**4. "Apply detected flags" is a client-side merge into the profile's `compat`.**
The probe already returns `detected` in the shape of a profile's `compat`; the UI deep-merges it over
the profile's `compat` and saves through `PUT /providers/:id` (the one profile write path). No
apply route: it would need the detected payload back or a second probe, and a second write path to
keep honest. A profile's `compat` is a plain field-wise merge, matching the resolver's precedence.

**5. The catalog editor reuses `ModelControls` + `RuntimeOptionsEditor` unchanged.**
S3's adapter already supplies `listModels` (ids `providerId/modelId`, source detected/static),
`configSchema()` and per-model `efforts`, and the editor already generates a control per schema
property with min/max/enum and already feeds the picker from `useRuntimeModels`. The slice therefore
adds a test that the generated set for the `weave` schema covers every parameter captain named and
that an out-of-range value is refused, rather than a second editor. Alternative: a weave-specific
parameters form. Rejected: two editors would drift from the schema the runtime validates with.

**6. The Providers section is workspace scope only.** Providers are workspace config and keys are
workspace secrets; there is no daemon-level provider. It is added to `V2_WORKSPACE_SECTIONS` and the
`WorkspaceBody` switch, so it addresses the selected workspace through the same `WorkspaceProvider`.

## Risks / Trade-offs

- [The provider list route reads only loaded workspaces] → the route is workspace-scoped
  (`ws.route('/providers', …)`), so it reads `c.get('ws').ctx.config`, never a daemon-wide map.
- [A preset name with no entry in the UI's base-URL map gets no suggestion] → the field falls back to
  an empty base URL the user must fill; the preset id and compat still apply.
- [Secrets in test snapshots] → tests assert on status text and the secret's *name*, never a value;
  the secret input uses `type="password"` and `autoComplete="off"`, as the existing input does.
- [Probe runs against a real endpoint when a human clicks Test] → it is user-initiated and uses the
  provider's own configured key; the ticket itself never configures a provider or clicks it.
- [Applying detected flags could clobber hand-edited compat] → the merge is field-wise over the
  detected subset, and it is an explicit user action on the result card.

## Migration Plan

Additive: no config schema field, migration or default changes. An existing hand-written provider
appears in the new list unchanged; a workspace with none shows the empty state and the preset
catalogue. Rollback is the revert of the UI section and routes; config written through the routes is
ordinary provider config.

## Open Questions

None that change the specs or the task breakdown.
