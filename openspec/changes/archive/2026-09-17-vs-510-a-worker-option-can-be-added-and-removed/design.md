## Context

The worker-option catalog is stored in the existing workspace and daemon model settings and is
written through the existing model PUT paths. The shared schema validates the shape of a complete
catalog, while the core and daemon services validate runtime-specific options against registered
adapters. Worker settings are resolved when a run is created, so the run engine already has the
right boundary for keeping an in-flight turn on its original settings. See `proposal.md` and the
delta spec for the externally visible contract.

## Goals / Non-Goals

**Goals:**

- Make every edit an immutable-id replacement of one complete option object, preserving fields not
  touched by the control that initiated the edit.
- Make workspace and daemon writes apply the same catalog and registered-runtime checks.
- Keep resolution atomic at spawn time: existing runs retain their resolved setting, later runs see
  the saved option.
- Give the Settings row a real edit state for runtime, model, effort and runtime options, with
  errors and limits visible before a write.

**Non-Goals:**

- Renaming option ids or migrating existing ticket references.
- Changing ticket assignment rules, option precedence, or the worker default setting.
- Probing credentials or launching a runtime merely to validate a catalog edit.

## Decisions

1. **Use the existing full-catalog PUT contract.** The editor will send a complete catalog with
   exactly one option changed. This keeps add, edit and remove under the same schema, duplicate-id
   checks, size limit, persistence, and event path. A patch endpoint was considered, but would
   create a second validation and merge path where omitted fields could be lost.

2. **Validate runtime identity at the service boundary.** For every configured option, both model
   services will require the runtime id to be present in the process runtime registry before saving,
   and will retain the existing adapter `configSchema()` validation for runtime-specific options.
   The UI will use the runtime detection list for immediate feedback and disabled choices, while
   the server remains authoritative. Calling `detect()` during a write was considered, but would
   make a configuration write depend on a subprocess probe and would conflate a temporarily
   unavailable binary with an unknown runtime id.

3. **Preserve untouched fields by object spread from the stored option.** Row controls will derive
   their next value from the current complete option and replace only the field being edited.
   Runtime changes in the shared model control will support an option-row mode that does not clear
   effort or other option fields; model changes will retain the same option object and use the
   existing effort derivation only when the user explicitly changes the model.

4. **Keep the existing spawn snapshot boundary.** `modelSettingFor` continues to resolve the
   option once while preparing a turn. No live run will reread the catalog, and no ticket's stored
   `workerModelId` will be rewritten. Tests will assert both the persisted id and the old/new
   settings across an edit and subsequent spawn.

5. **Represent an unset runtime explicitly in the editor.** An unconfigured row will show the
   runtime control and an unavailable/disabled model, effort, and runtime-option area rather than
   substituting the first installed runtime. This avoids suggesting that a value can take effect
   before the option is runnable and keeps the row consistent with the catalog data.

## Risks / Trade-offs

- [Risk] Existing configuration files may contain runtime ids no longer registered.
  → Reads remain tolerant; only a write that retains or introduces such an option is rejected with
  the runtime id, making the problem actionable without silently rewriting the catalog.
- [Risk] A catalog edit can race with another settings write.
  → Continue using the current serialized model service save/event path and full-catalog payload;
  add tests around the service's final validation rather than introducing client-side merging.
- [Risk] UI-only validation can drift from server rules.
  → Derive field limits from shared schemas and keep server validation authoritative; exercise both
  the UI refusal and direct invalid PUT cases.

## Migration Plan

No data migration is required. The new behavior is backward-compatible for valid catalogs. Deploy
the service validation and editor together; rollback restores the prior editor while leaving the
catalog format unchanged.
