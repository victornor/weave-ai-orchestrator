## Why

A worker option's `description` is the only signal the weaver reads when choosing a tier, yet it is
write-once: `Settings.tsx`'s `WorkerOptionRow` renders it as static text at `:1026` and passes the
old value straight back at `:1044`, so only runtime/model/effort can be changed after creation. The
only ways to reword a prompt are deleting and recreating the option (which strands every ticket that
references its id) or hand-editing `daemon.yaml` and restarting. captain hit this while trying to
correct the weaver's over-reach for the deep tier.

## What Changes

- The existing-option row in the worker-option catalog gains an editable description field, using
  the same `useCommittableField` machinery every other Settings text field uses (draft, Enter / Save
  / blur / unmount-to-commit, visible unsaved/saved/error state).
- The field is validated against `WorkerModelOptionSchema.shape.description` — the same shared
  schema the add form already reads `descMax` from — and shows the cap while editing. An over-length
  or empty description is refused with the reason before the catalog is written.
- The option `id` stays immutable: the row keeps rendering it as a heading and renders no id input.
- The write goes through the catalog's existing save path (the whole `workerOptions` array via
  `PUT /models` or `PUT /api/daemon/models`); no new endpoint, no schema change.
- The row is shared by the workspace catalog and the daemon catalog overlay, so both surfaces gain
  the same edit, each writing to its own catalog.
- No re-routing of past tickets: an edit changes future `weave_worker_models` output only, and the
  dispatch/routing logic is untouched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-selection/worker-options`: adds the requirement that an existing option's description is
  editable in place, with the id immutable and the schema's character cap visible, while preserving
  the option's runtime, model and effort.

## Impact

- `packages/ui/src/routes/Settings.tsx` — `WorkerOptionRow` gains the description control;
  `WorkerOptionsEditor`/`WorkerOptionRow`'s `onSave` becomes promise-returning so a rejected save can
  be shown on the field, with both call sites (`ModelsSection`, `DaemonWorkerOptions`) updated.
- `packages/ui/src/test/models.test.tsx` — new coverage plus the daemon-save mock gaining
  `mutateAsync`.
- `packages/shared/src/config.ts` — unchanged. The 200-character cap and the catalog schema stand.
- No server, route, API-doc, CLI, or OpenSpec/spec-index change. `weave_worker_models` already
  returns descriptions from the effective catalog.
