## 1. Shared schema and types

- [x] 1.1 In `packages/shared/src/config.ts`, change `WorkspaceModelsPutSchema` so each of `weaver`
  and `workers` is `ModelSettingSchema.nullish()` and `workerOptions` is
  `WorkerOptionsArraySchema.nullish()`; update its comment to state set/clear/keep. Add
  `MODEL_SOURCES` (or an equivalent union) plus `ModelSource` and `WorkspaceModelsSource`, and a
  `WorkspaceModelsView = EffectiveModels & { source: WorkspaceModelsSource }` type.
- [x] 1.2 Add `modelsSource(stored, daemon)` to `packages/core/src/models/resolve.ts`: `'workspace'`
  when the workspace stores that control, else `'daemon'` when the daemon overlay is filled for it,
  else `'default'`; for `workerOptions`, a non-empty stored catalog is `'workspace'` and an empty or
  absent one falls through to the daemon catalog or the default. Export it from
  `packages/core/src/models/index.ts`.

## 2. Core write and read semantics

- [x] 2.1 Rewrite `createModelsService().set` in `packages/core/src/models/index.ts` to merge over
  `ctx.config.models`: a control whose input value is `undefined` keeps its stored value; `null`
  clears it (stored key becomes `undefined`); a value sets it; `workerOptions` `null` or `[]` stores
  an empty catalog. Validate the merged block with `WorkspaceModelsSchema` exactly as today, keep the
  `ensureConductor` restamp, the abandoned-runtime login-pause release, and the activity/event writes
  with before/after. `set` must still accept an `EffectiveModels` (every control is a value) so
  `settleWorkersRuntime` is unchanged.
- [x] 2.2 Change `ModelsService.get()` to return `S.WorkspaceModelsView` and `set()` to return it
  too — the effective values plus `source` computed from the stored block and the daemon overlay.
  Update the `ModelsService` interface in `packages/core/src/api.ts`. Confirm the one internal
  consumer (`weave_worker_models` in `packages/server/src/tools.ts`) still typechecks unchanged.
- [x] 2.3 Update `packages/server/src/routes/models.ts` and its module comment: PUT parses the new
  body and returns the sourced view; GET returns it. Update `docs/API.md`'s `GET /models` and
  `PUT /models` entries for the per-control set/clear/keep body and the additive `source` field.

## 3. Core and server tests

- [x] 3.1 In `packages/core/src/models/models.test.ts`, cover: setting `weaver` alone leaves stored
  `workers` unset (and a later daemon workers overlay still governs it); `null` clears a stored
  control so it follows the daemon overlay, and the default when the overlay is empty; an omitted
  control keeps its stored value; `workerOptions: null` inherits the daemon catalog; an old
  two-field body behaves as before; `modelsSource` reports `workspace`/`daemon`/`default` correctly,
  including an inherited value that happens to equal the workspace's.
- [x] 3.2 In `packages/server/test/integration.test.ts`, add route cases for PUT with `null`,
  omitted and value per control, for `workerOptions: null`, and for the `source` fields on GET and
  PUT. Update the existing exact-shape assertions (lines around the VS-77 block) to include
  `source`, and the legacy-conductor and VS-162 cases if their response shape changed.

## 4. CLI

- [x] 4.1 In `packages/cli/src/commands/models.ts`, make `set` send only the changed control
  (`{ [field]: next }`), accepting `conductor`, `weaver` and `workers` as the control names. Add
  `weave models inherit <conductor|weaver|workers|options>` that clears one control (`{ [field]:
  null }`, or `{ workerOptions: null }`), mirroring `weave daemon models set --clear`. Make `show`
  print each control's source from the read.
- [x] 4.2 In `packages/cli/src/program.test.ts`, add tests that a set request body names only the
  changed control, that `inherit` sends `null` for that control only and accepts `weaver` as well as
  `conductor`, and that `show` prints the source; update existing `models set` assertions whose
  bodies change. Update PLAN §20 and the README cheat-sheet for the new command if either lists the
  `models` command tree.

## 5. V1 Settings

- [x] 5.1 In `packages/ui/src/routes/Settings.tsx`, make `ModelsSection` send only the changed
  control for agent edits and `{ workerOptions: ... }` for catalog edits. Show each control's source
  and offer "Use daemon default" on a control whose source is `'workspace'`, which sends
  `{ [kind]: null }`. Keep the layout and controls otherwise as they are.
- [x] 5.2 Update `packages/ui/src/api/types.ts` with `ModelSource`, `WorkspaceModelsSource`, the
  source on the workspace models read, and a `WorkspaceModelsPut` body type; update `useSetModels` in
  `packages/ui/src/api/hooks.ts` to take the put body and to cache the returned view.
- [x] 5.3 In `packages/ui/src/test/models.test.tsx`, assert the V1 section sends only the changed
  control on an agent edit and on a catalog edit, and that "Use daemon default" sends `null` for that
  control. Add `source` to the fixture `WorkspaceModels` literals.

## 6. V2 Settings

- [x] 6.1 In `packages/ui/src/v2/settings/override.ts`, replace the value comparison with reads of
  the reported source: `agentOverrideState`/`optionOverrideState` become source-based, and
  `countOverrides` counts the controls (weaver, workers, workerOptions) whose source is `'workspace'`
  from the same map. Keep `diffSetting`/`diffOption` for the footer text.
- [x] 6.2 In `packages/ui/src/v2/settings/sections/Models.tsx`, derive each tag and the banner from
  `source`, send only the changed control on agent Override, send `null` on Reset, and handle worker
  options at catalog granularity: inherited shows the daemon's list recessed with Override seeding
  the workspace catalog from the daemon's; overridden is editable and Reset sends `null`. Remove the
  value-comparison copy about the pinning trade-off.
- [x] 6.3 In `packages/ui/src/test/v2settingsOverride.test.ts` and
  `packages/ui/src/test/v2settings.test.tsx`, assert tags come from `source`, Override writes only
  one control, Reset sends `null`, the banner count matches the tags, and the inherited catalog shows
  the daemon's list. Update the mocked `useModels` data with a `source` map.

## 7. Spec and verification

- [x] 7.1 Keep the two spec deltas
  (`specs/model-selection/workspace-model-settings/spec.md` and `specs/web-v2/settings/spec.md`)
  accurate; adjust wording only if implementation shows it wrong.
- [x] 7.2 Run `openspec validate vs-356-workspace-models-let-each-agent-weaver-w --json --strict` and
  verify it is clean.
- [x] 7.3 Run `pnpm lint` and `pnpm typecheck`; verify both are clean.
- [x] 7.4 Run `pnpm test` (core/server suite) and
  `pnpm --filter @weave-ai/ui exec vitest run` separately; paste both suite blocks verbatim in the
  report and verify both pass, including every new test above.
- [x] 7.5 Confirm no database migration was added and no daemon-overlay behavior changed.
