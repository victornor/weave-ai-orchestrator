## Why

Captain, 2026-09-10, adding worker model options in Settings: the description field accepted a
225-character value, the Add button stayed enabled, and the only feedback was the server's 400
(`workerOptions.0.description … at most 200 character(s)`). Every rule the daemon enforces on the
catalog already exists in one place — `WorkerModelOptionSchema`
(`packages/shared/src/config.ts:109`), which `packages/ui` already depends on. The form is not
missing the rule; it never consults it. A form that lets you submit values its own API will
reject, reporting the rejection only after the round-trip, is the same complaint raised about the
daemon-models controls earlier that night (VS-207).

## What Changes

- A small shared helper in `packages/ui` turns a Zod schema into field state: parse a draft, get
  `{ valid, byPath }` — the first issue per field. No general form framework.
- The worker-options add form (one editor; the workspace Models section and the daemon overlay
  both mount it) validates the entry against `WorkerModelOptionSchema` while it is typed:
  violations show at the offending input, and Add is unavailable while the entry would be
  rejected — over-length description, non-kebab id, duplicate id, and the 16-option cap included.
  An empty pristine form keeps Add disabled, replacing today's silent no-op on click.
- `WorkerOptionsArraySchema` (the catalog array with its `.max(16)` and duplicate-id
  `superRefine`) is exported from `packages/shared` so the form validates against exactly what
  the daemon validates, instead of hand-picking field rules.
- The add-project form's Max workers input gets the same treatment: its bounds derive from
  `ProjectConfigSchema.shape.maxWorkers` (integer 1..32), replacing the hardcoded HTML
  `max={16}` that has already drifted from the schema's 32, with the error at the field while
  typing and Add unavailable while out of bounds.
- Server validation is unchanged everywhere. This adds a client-side guard; it does not move the
  enforcement. The API must still reject a bad payload from any other caller.
- The remaining Settings forms are swept and stated in the PR rather than silently skipped:
  change-password already enforces the server's 8-character minimum before submit; the
  committable fields already surface a rejected save at the field (`web-settings/field-commit`,
  VS-141) and several carry their own client checks; everything else is enum-valued selects and
  toggles that cannot produce a schema-rejected write.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-selection/worker-options`: wherever a worker option is added, the editor enforces the
  catalog's rules before submit — violations at the input while typing, Add unavailable while
  the entry would be rejected, limits derived from the shared schema rather than restated.
- `web-settings/add-project`: the Max workers input follows the shared project schema's bounds,
  flagged at the field before any submit.

## Impact

- `packages/shared/src/config.ts` — `WorkerOptionsArraySchema` gains `export` (additive; no
  shape change; flows through the package's existing config re-exports).
- `packages/ui/src/lib/schema-field.ts` (new) + `schema-field.test.tsx` — the shared helper and
  its unit tests (`packages/ui`'s vitest include is `*.test.tsx` only, so the test takes that
  suffix like `commit-field.test.tsx` does).
- `packages/ui/src/routes/Settings.tsx` — `WorkerOptionsEditor` gains the derived field state and
  error display (serves both mount points); `ProjectsSection`'s Max workers input gains bounds
  and a disabled Add.
- `packages/ui/src/test/models.test.tsx` — the worker-option editor cases; the add-project cases
  go in whichever existing suite renders that form.
- No API, CLI or core changes: `PUT /api/daemon/models` and `POST /projects` validation stay
  exactly as they are.
