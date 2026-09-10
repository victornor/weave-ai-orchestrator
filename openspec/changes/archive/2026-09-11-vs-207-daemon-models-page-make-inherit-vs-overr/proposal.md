## Why

Captain, 2026-09-10, on the daemon Models settings page (added by VS-185): touching any control on
a row that inherits the workspace setting silently creates an override, because the fields are
pre-filled with a fallback value that looks identical to a real override and every change commits
it. There is no way to browse the options without pinning a value, and no visible sign of which
state a row is in. Separately, the worker-options catalog's model field is free text while every
other model control on the page is a picker, so a typo silently produces an invalid model id.

## What Changes

- **Daemon Models' Conductor and Workers rows get an explicit scope control** — a select with
  "Inherit" (labelled with the workspace value it currently resolves to) and "Override" — instead
  of inferring the state from whether a "Use per-workspace settings" button happens to be present.
  Choosing "Override" is the one interaction allowed to create the overlay; choosing "Inherit" is
  the one interaction allowed to clear it. No other control write can do either.
- **`ModelSettingFields` is fully disabled while inheriting** (runtime select, model select, and
  the free-text escape hatch, which today keeps accepting input even when `disabled` is passed),
  so opening or changing any of those controls while inherited is a no-op, not a write.
- **The inherited value is real, not a placeholder.** The fallback shown and edited-from is the
  current workspace's own stored conductor/workers setting (read once via the same `useModels`
  query the workspace Models section uses), not a hardcoded `{ runtime: 'claude', model: null }`.
  The row's hint says this is one workspace's value and that others may differ.
- **The worker-options model field becomes a picker** drawn from the selected runtime's model
  list (`useRuntimeModels`), with an explicit "runtime default" entry, reusing the same
  known-vs-custom detection `ModelSettingFields` already has. Free text remains as a secondary
  "something else…" escape hatch — kept because several runtime adapters return an empty or
  incomplete catalog (VS-129), so a picker alone would make an otherwise-valid model unreachable.
  This is the same component used by both the workspace catalog and the daemon catalog overlay, so
  both get the fix from one change.
- No storage or API change: `null` still means inherit, an overlay's presence still means
  override. This is entirely about the Models sections representing that state honestly.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-selection/daemon-overrides`: adds the requirement that the daemon Models page presents
  each of the conductor and workers overlay rows as an explicit inherit-or-override choice, shows
  the value being inherited, and never creates or clears an overlay as a side effect of any other
  interaction.
- `model-selection/worker-options`: adds the requirement that a worker option's model is chosen
  from the runtime's model catalog with an explicit runtime-default entry, with free text as a
  secondary escape hatch for a model the catalog does not list.

## Impact

**Code.** `packages/ui/src/routes/Settings.tsx`: `OverlaySetting`, `ModelSettingFields`,
`WorkerOptionsEditor`, `DaemonModelsSection`. No other package changes; no schema or route change
(`packages/shared/src/config.ts`'s `ModelSettingSchema`/`DaemonModelsSchema` are unchanged, per the
ticket's note that the data model is already correct).

**Tests.** `packages/ui/src/test/models.test.tsx` gains coverage for the new scope control and the
worker-option model picker; its existing "opens daemon Models from This daemon and PUTs an
overlay" test, which today asserts that changing the runtime select while inheriting writes an
overlay, is rewritten to assert the opposite (inheriting is inert; choosing Override is what
writes). `packages/ui/src/test/settingsScopes.test.tsx` is checked for the same assumption.

**Docs.** No `docs/PLAN.md`/`docs/API.md` change (no new route, field, or CLI surface).
