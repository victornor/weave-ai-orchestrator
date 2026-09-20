## 1. Shared schema declaration and discovery code

- [x] 1.1 In `packages/shared/src/runtime-options.ts`, add a JSON-Schema-shaped declaration of a provider model entry's fields (`contextWindow`, `maxOutputTokens`, `compat`, `params`) beside `runtimeOptionProperties`, export it from the package index; add a test that `runtimeOptionProperties` on it lists exactly the keys of `ProviderModelSchema.shape`
- [x] 1.2 In `packages/agent`, add `listProviderModels({ profile, apiKey?, fetch? })` returning `{ ok, models: [{ id, contextWindow? }], error? }`, resolving preset/compat/`modelsPath`/`contextField` and `requestHeaders` (default User-Agent), with a 10 s timeout and a one-line failure reason; unit tests against a mock fetch for a list, a non-200 and a non-list body; export it from the package index
- [x] 1.3 Re-export `listProviderModels` from `@weave-ai/runtime-weave` and make the adapter's `discover` closure delegate to it, keeping its ten-minute cache; the existing discovery tests in `packages/runtimes/weave/test/providers.test.ts` still pass

## 2. Server routes

- [x] 2.1 Add `POST /providers/:id/discover` to the scope-parameterised handler (`packages/server/src/routes/providers.ts`): body `{ profile?, apiKey? }`, profile defaults to the scope's stored entry, key defaults to the scope's secret store, response `{ ok, models, error? }`, nothing stored, no key returned; load the function by specifier as `loadProbe()` does; route tests at both scopes for the stored key, the draft profile, the body key, a failure reason, and that no key value appears in a response
- [x] 2.2 Change the no-model message in `POST /providers/:id/test` to `provider <id> has no models; add one on the Providers page or pass a model to test` and add a route test that a named body model is used; keep `README`/routetable/`docs/API.md` entries in step
- [x] 2.3 Register the discover route in `packages/server/src/routetable.ts` and document both changed routes in `docs/API.md`

## 3. Providers UI

- [x] 3.1 Lift the generated option control out of `Models.tsx` into a shared component and teach it an `object` field (JSON textarea); the runtime-options editor keeps its behavior
- [x] 3.2 In `packages/ui/src/v2/settings/sections/Providers.tsx`, add a models editor to `ProviderRow` at both scopes: list entries, add/edit/remove each with a required id and the schema-derived fields, an explicit empty state, and `save` writing `profile.models`; render tests in both themes for empty, add, edit, remove and save
- [x] 3.3 Add `useDiscoverProviderModels` plus its response type to `packages/ui/src/api/hooks.ts`/`types.ts`, and a "Fetch from endpoint" action in the models editor that sends the draft profile and any typed key, lists the ids to pick from, appends a picked one, and shows a failure reason while manual entry stays; render tests with the hook mocked
- [x] 3.4 Replace both Test connection buttons' plain action with a model selector (configured models plus a free-text id), send the chosen id as `asked`, and disable the button with the hint `add or type a model to test` when none is available; render tests for disabled/enabled and the sent model
- [x] 3.5 In `Models.tsx`, when the chosen runtime is `weave` and it reports no models, show a line naming the empty catalog with a link to `/settings?section=providers`; render test
- [x] 3.6 Add an integration test that a daemon-level `weave` worker option can pick a model of a provider whose models were added on the Providers page, in a workspace with no provider config of its own

## 4. Docs, captures and suites

- [x] 4.1 Update `docs/running-the-agent-yourself.md` (a provider's models can be added or fetched in Settings) and the `builtin-agent-design` open-question/slice notes if they describe the models field as discover-only
- [x] 4.2 Real-browser captures, both themes, of the Providers page for a codeify-shaped provider (base URL, no models) before adding a model, and after adding one and testing it against a mock endpoint; open each capture to confirm it shows what is intended, then attach them to the ticket
- [x] 4.3 Run the full core/server suite and the full UI suite once each with `--maxWorkers=4`, and paste both blocks verbatim in the report
