## Why

Changing a worker option's runtime in Settings → Models silently drops the option's `effort`. The
runtime select rebuilds the option from four named fields — `id`, `description`, `runtime`, `model`
— and `effort` is not one of them (`packages/ui/src/routes/Settings.tsx:1044`). The schema accepts
the result (`ModelSettingSchema.effort` is `z.string().optional()`), so nothing rejects it and
nothing on the screen shows `effort`; the value is simply gone. This is live data loss: all three
worker options in this daemon's catalog carry `effort: high`, and captain is about to use this
screen.

## What Changes

- The existing worker-option row's runtime select SHALL spread the option it is editing
  (`patch({ ...option, runtime, model: ... })`) instead of re-listing named fields, so a field the
  row does not edit — `effort` today, anything added later — survives the change.
- The same row is checked for any other control that reconstructs the option from named fields
  rather than spreading. The model select, the free-text model input and both thinking-level
  controls already spread (`{ ...option, ... }`); the runtime select is the only offender, so the
  fix is confined to it.
- A regression test asserts that changing an existing option's runtime preserves its stored
  `effort`, and it must fail against the current code.

Out of scope: making `effort` editable on that row (it is not shown today), the description edit
(VS-299), and anything else in the models catalog.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `model-selection/worker-options`: the requirement "An existing catalog option can be configured
  in place" currently says a runtime or model change persists the option's *id and description*
  unchanged. It is broadened to say a runtime or model change persists *every* field the control
  does not itself edit — explicitly including `effort` — with a scenario asserting it.

## Impact

- `packages/ui/src/routes/Settings.tsx` — `WorkerOptionRow`'s runtime `onChange`, one call
  expression.
- `packages/ui/src/test/models.test.tsx` — one regression test in the worker-options coverage.
- No schema, API, daemon or migration change: the catalog already stores and returns `effort`; only
  the UI edit path loses it.
