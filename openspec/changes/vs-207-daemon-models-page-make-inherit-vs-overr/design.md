## Context

`packages/ui/src/routes/Settings.tsx` has three components at the center of this change:

- `ModelSettingFields` — a runtime `<select>` + model `<select>` (with a "something else…"
  escape hatch to a free-text box) for one `ModelSetting`. Used directly by the workspace
  `ModelsSection` (conductor/workers, always a concrete value) and wrapped by `OverlaySetting`
  for the daemon overlay rows.
- `OverlaySetting` — wraps `ModelSettingFields` for a nullable overlay. Today: `setting ?? fallback`
  is always passed in, so the fields look the same whether `setting` is null (inheriting) or equal
  to `fallback` by coincidence (overridden). Every `onChange` calls `onFill`, so browsing the
  fields while inheriting creates the overlay. A "Use per-workspace settings" button appears only
  once `setting != null`.
- `WorkerOptionsEditor` — the "add a worker option" form (id, description, runtime, model) plus the
  existing list. Shared verbatim by the workspace catalog (`ModelsSection`) and the daemon catalog
  overlay (`DaemonWorkerOptions`). Its model field is a bare `<input>`.

See proposal.md - Why/What Changes for the two complaints. `model-selection/daemon-overrides` and
`model-selection/worker-options` (openspec/specs) hold the existing data-level contract, which this
change does not touch.

## Goals / Non-Goals

**Goals:**
- Conductor/Workers overlay rows state inherit-vs-override explicitly and let the operator choose
  either at any time.
- No interaction other than that explicit choice can create or clear an overlay.
- The worker-option model field is a picker consistent with the rest of the page, with free text
  kept as a secondary escape hatch.
- One fix in the shared components benefits both the daemon and workspace Models sections.

**Non-Goals:**
- No change to `DaemonModelsSchema`/`ModelSettingSchema`/the `/api/daemon/models` or
  `/api/models` routes. `null` already means inherit; this is a rendering fix only.
- No inline editing of an existing worker option (there isn't one today; out of scope to add it).
  The picker fix applies to the "add" form, which is the only place a worker option's fields are
  entered.
- The worker-options **catalog itself** (the daemon `workerOptions` overlay, a list) does not get
  an inherit/override toggle. A non-empty list already unambiguously means "this daemon catalog
  replaces the workspace catalog"; adding an option is already a deliberate, button-driven act
  (`WorkerOptionsEditor`'s add flow never fires from merely opening a control), so Problem 1 does
  not apply to it. Only the ticket's named Conductor/Workers rows get the scope control.

## Decisions

**Scope control is a `<select>`, mirroring the project-row YOLO override control.** This file
already has an established idiom for "inherit vs. explicit value" — `ProjectRow`'s
`yoloOverrideOf`/`withYolo`, a `<select>` whose first option is `inherit (<current effective
value>)` and which drops the override key entirely when that option is chosen. `OverlaySetting`
gets the same shape: a select with two options, `inherit — <runtime> · <model>` and `override`.
Choosing `inherit` calls `onClear()`; choosing `override` calls `onFill(fallback)` once, seeding
the overlay from the value being inherited so the switch itself changes nothing observable.
Alternative considered: a segmented two-button toggle (Inherit / Override). Rejected only to stay
consistent with the file's existing convention rather than adding a second idiom for the same kind
of choice.

**`ModelSettingFields` becomes fully inert when `disabled`.** Today `disabled` only reaches the two
`<select>`s; the free-text escape-hatch `<input>` has no `disabled` attribute and its `onChange`
has no guard, so a locked or inheriting row could still be edited through it. Add `disabled` to
that input and an `if (disabled) return;` guard at the top of every one of the field's `onChange`
handlers (defense in depth — some test tooling dispatches `change` events on disabled elements
directly, bypassing the browser's own block on user interaction). This is what makes "opening or
changing an inheriting row's fields does nothing" true regardless of how the test fires the event,
and it also closes a latent gap in the existing `locked` (daemon-overlay-governs-workspace)
disabled state, which had the same hole.

**The fallback shown while inheriting is the viewed workspace's own stored setting, not a
hardcoded default.** `DaemonModelsSection` calls the same `useModels()` the workspace Models
section uses and passes `workspaceModels.data.conductor` / `.workers` as `fallback` instead of
`emptySetting(runtimes)`. This is the one concrete, real value available to show and to seed an
override from. Because the overlay is daemon-wide while each workspace's own setting can differ,
the row's copy says "this workspace's setting" rather than asserting it as universal (per the new
`daemon-overrides` requirement's second scenario) — e.g. "Inheriting ws1's own setting; other
workspaces may hold a different one." `emptySetting(runtimes)` remains the fallback used by
`DaemonWorkerOptions`' add-a-new-option form, which was never claiming to show an inherited value.

**The worker-option model field reuses `ModelSettingFields`' known-vs-custom detection, not its
commit lifecycle.** `ModelSettingFields`' free-text box uses `useCommittableField` because it
auto-saves on blur against a setting that already exists server-side (debounce needed so every
keystroke does not PUT). `WorkerOptionsEditor`'s new-option form has no such per-field save — its
fields (`id`, `description`, `runtime`) are already plain local state, submitted together on
"Add worker option". The model field gets the same shape (plain local state, no debounce needed
since there is nothing to over-save), not the commit-field machinery. What's shared is the small
"is this model in the runtime's known list" check, factored out so both places agree on when to
show the custom-text escape hatch. Alternative considered: a fully generic `ModelPicker` covering
both commit styles behind a render-prop for the custom field. Rejected as more machinery than two
~15-line, differently-wired call sites justify.

## Risks / Trade-offs

**[Risk]** Showing "this workspace's own value" while inheriting could be misread as "the value
every workspace gets" for an operator who has only ever used one workspace on this daemon → the
row's copy states explicitly whose value it is; the daemon-overrides delta spec has a scenario
requiring this is never asserted as universal.

**[Risk]** Disabling `ModelSettingFields` for the whole row while inheriting removes the previous
(accidental) ability to browse the model catalog without committing → intentional per the ticket:
browsing without a value is available by switching to "override" (seeded from the current
inherited value, so nothing changes until the operator picks something different), not by leaving
the row disabled-but-browsable.

**[Risk]** Existing test `models.test.tsx`: "opens daemon Models from This daemon and PUTs an
overlay (VS-185)" currently asserts that changing the runtime select while inheriting performs the
write — the exact behavior this change removes → the test is rewritten (task list) to assert the
new contract: the select is inert while inheriting, and choosing "override" is what writes.

## Migration Plan

No data migration — the daemon overlay storage shape and the `/api/models` /
`/api/daemon/models` payloads are unchanged. This ships as a normal PR/merge; nothing needs
sequencing with a running daemon beyond the usual web-app asset rebuild.

## Open Questions

None — the scope, the picker's escape-hatch retention, and the inherited-value source are all
decided above rather than deferred.
