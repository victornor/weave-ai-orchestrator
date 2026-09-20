## 1. Server: provider administration

- [x] 1.1 Re-export `PRESET_NAMES` and `loadPreset` from `@weave-ai/agent` in `packages/runtimes/weave/src/index.ts`; verify `pnpm --filter @weave-ai/runtime-weave test` passes and a unit test loads one preset through the runtime package.
- [x] 1.2 Add `GET /providers` in `packages/server/src/routes/providers.ts` returning each configured profile (without its key), whether its `apiKeySecret` holds a value, and the preset catalogue `{ id, description }`; verify a route test with two providers (one key set, one not) and an empty workspace, asserting no response field carries a key value.
- [x] 1.3 Add `PUT /providers/:id` (validated through `WorkspaceConfigSchema`) and `DELETE /providers/:id`; verify route tests cover create, update, remove, an invalid profile refused with issues, and that the stored config is unchanged on refusal.
- [x] 1.4 Add `POST /providers/:id/secret` and `DELETE /providers/:id/secret` writing the workspace secret store via `ws.services.secrets`; verify tests assert the value is held, the response carries only status, a provider without `apiKeySecret` is refused, and no error text contains the value.
- [x] 1.5 Register the new routes in `packages/server/src/routetable.ts` and document every one in `docs/API.md`; verify the server suite and any routetable/API coverage test pass.

## 2. UI: provider types, client and hooks

- [x] 2.1 Add the provider wire types (`ProviderProfile` subset, provider summary with secret state, preset summary, test report with `checks`/`detected`) to `packages/ui/src/api/types.ts`; verify the UI typechecks.
- [x] 2.2 Add `useProviders`, `useSaveProvider`, `useDeleteProvider`, `useSetProviderSecret`, `useClearProviderSecret` and `useTestProvider` hooks plus query keys, invalidating the provider list on a write; verify a hook/route-mock test observes the right method, path and body.

## 3. UI: the Providers section

- [x] 3.1 Add a `providers` section to `V2_WORKSPACE_SECTIONS` and the `WorkspaceBody` switch; verify the settings test navigates to it and the section renders for the selected workspace.
- [x] 3.2 Build `packages/ui/src/v2/settings/sections/Providers.tsx` with the provider list (id, base URL, preset, secret state), the data-flow notice, add-from-preset, the edit form and remove-with-confirmation; verify component tests cover list, add and edit against mocked routes.
- [x] 3.3 Wire the secret input (masked, not autofilled, never showing a stored value) with set/replace/clear and the configured/not-configured status plus the secret name; verify a test types a key, saves it, and asserts the DOM and the rendered output contain no key value.
- [x] 3.4 Render Test connection results per capability with their detail, and an apply-detected-flags action that merges `detected` into the profile's `compat` and saves; verify tests cover a passing result, an empty `detected` (no apply action) and the applied merge.
- [x] 3.5 Add the UI tests for the add, edit, remove, secret and test flows against mocked routes; verify `pnpm --filter @weave-ai/ui test` passes and no snapshot contains a key value.

## 4. UI: the `weave` runtime in the catalog editor

- [x] 4.1 Verify the existing `ModelControls`/`RuntimeOptionsEditor` already render the `weave` runtime's models from `listModels`, efforts from `RuntimeModel.efforts` and a control per `configSchema()` property; add a component test asserting a control exists for every parameter captain named (`maxOutputTokens`, `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `seed`, `stop`, `toolChoice`, `parallelToolCalls`, `responseFormat`, `extraBody`).
- [x] 4.2 Verify an out-of-range parameter is refused with the schema's message on save and no undeclared option reaches the setting; add the test.

## 5. Verification and delivery

- [x] 5.1 Run `pnpm lint` and `pnpm typecheck`; verify both are green.
- [x] 5.2 Run one full test pass (`--maxWorkers=4`) for the core/server suite and the UI suite; verify both blocks are pasted into the report, separately.
- [x] 5.3 Capture dark and light screenshots at desktop and phone width for the provider list, the add-from-preset flow, the test-connection result and the catalog editor; keep them outside the worktree and attach them to the ticket.
- [x] 5.4 Update the design docs in the knowledge base where this slice changed them; verify the entry is linked from its hub.
