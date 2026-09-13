## Why

A workspace cannot inherit one agent's model from the daemon while overriding the other. The storage
and resolution already work per field (`effectiveModels` computes `stored?.weaver ?? overlay.weaver
?? default`), but the write API requires both settings in one body, so every writer pins the control
it did not touch. VS-348's V2 Settings had to fake inherit by comparing values against the daemon,
and as a result saving a weaver override also pins the workers' current value in `workspace.yaml`
(and vice versa) — that workspace then silently stops following later daemon default changes for the
agent nobody overrode. There is also no way to read back whether a value is inherited or pinned, nor
to clear one control back to inherit.

Captain removed the trade-off on 2026-09-13: make the API store inherit for one control on its own,
and use it in V2 Settings, the CLI and V1.

## What Changes

- **`PUT /api/w/:ws/models` is per control.** For `weaver` and `workers`, the body accepts a
  `ModelSetting` to override, `null` to clear the workspace value and inherit, or omission to keep
  what is stored. `workerOptions` accepts an array to replace, `null` (or `[]`) to clear and inherit
  the daemon catalog, or omission to keep. Only the controls actually named are written. Old
  two-field bodies keep behaving exactly as before. As today, a write still restamps the weaver,
  releases login pauses for abandoned runtimes, and records the activity and event with before/after.
- **`GET /api/w/:ws/models` says where each value comes from** — additively. Each of `weaver`,
  `workers` and `workerOptions` is reported with a source of `'workspace' | 'daemon' | 'default'`,
  alongside the effective values it already returns, so a client can tell inherited from a pinned
  value that happens to be equal. `PUT` returns the same view. Shared types and the UI API types are
  updated.
- **CLI.** `weave models set weaver|workers` sends only the changed control. `weave models inherit
  weaver|workers|options` clears one control back to inherit, matching the daemon command's
  `--clear` idiom. `weave models show` prints each control's source.
- **V1 Settings.** The workspace Models section sends only the changed control, so a V1 edit stops
  pinning the other agent. It shows each control's source and offers "Use daemon default" on a
  workspace-set control. Kept minimal.
- **V2 Settings.** The workspace override state switches from value comparison to the real source:
  the tag reads `inherited`/`overridden` from `source`, Override writes only that control, Reset to
  daemon sends `null`, and the banner count and footers derive from the same source map. Worker
  options follow the same rule at catalog granularity. The copy describing the pinning trade-off is
  removed.

## Capabilities

### New Capabilities

_None. The behavior extends the existing model-selection and V2 Settings capabilities._

### Modified Capabilities

- `model-selection/workspace-model-settings`: reads additionally report each control's source; a
  write may name one control and clear it to inherit, and each client (web V1 and CLI) sends only
  the changed control and shows its source.
- `web-v2/settings`: the workspace Models override state, banner and footers are derived from the
  reported source rather than by comparing values, Reset writes `null`, and worker options inherit
  or override as a catalog.

## Impact

- `packages/shared/src/config.ts` — `WorkspaceModelsPutSchema` becomes nullable/optional per field;
  new `ModelSource` / `WorkspaceModelsSource` and a view type.
- `packages/core/src/models/resolve.ts` — a source computation next to `effectiveModels`.
- `packages/core/src/models/index.ts` and `packages/core/src/api.ts` — `models.set` writes only the
  named controls and returns the sourced view; `get` returns it.
- `packages/server/src/routes/models.ts` and `docs/API.md` — the GET/PUT wire shape.
- `packages/cli/src/commands/models.ts` — partial set, new `inherit`, source in `show`.
- `packages/ui/src/api/types.ts`, `packages/ui/src/api/hooks.ts` — types and the PUT body.
- `packages/ui/src/routes/Settings.tsx` (V1) and `packages/ui/src/v2/settings/sections/Models.tsx`
  plus `packages/ui/src/v2/settings/override.ts` (V2).
- Tests in `packages/core/src/models/models.test.ts`, `packages/server/test/integration.test.ts`,
  `packages/cli/src/program.test.ts`, `packages/ui/src/test/models.test.tsx`,
  `packages/ui/src/test/v2settings.test.tsx`, `packages/ui/src/test/v2settingsOverride.test.ts`.
