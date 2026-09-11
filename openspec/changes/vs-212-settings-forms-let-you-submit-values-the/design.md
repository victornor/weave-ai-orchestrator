## Context

The rules already exist server-side and are the single source of truth:

- `WorkerModelOptionSchema` (`packages/shared/src/config.ts:109`): `id` matches the kebab-case
  slug regex `/^[a-z0-9][a-z0-9-]{0,63}$/`, `description` is `min(1).max(200)`, extended over
  `ModelSettingSchema` (`runtime` min(1) default `claude`, `model` nullable, `effort` optional).
- `WorkerOptionsArraySchema` (same file, module-local today): `z.array(...).max(16)` plus a
  `superRefine` rejecting duplicate ids. The daemon parses `PUT /api/daemon/models` with
  `DaemonModelsPutSchema`, which embeds it (`packages/server/src/routes/daemon.ts:244`).
- `POST /projects` validates `maxWorkers: z.number().int().min(1).max(32)`
  (`packages/server/src/routes/projects.ts:9`) via `ProjectConfigSchema`.

The editor: `WorkerOptionsEditor` (`packages/ui/src/routes/Settings.tsx:657`) holds
id/description/runtime/model/free-text state; `add()` trims, silently returns when id or
description is empty; the Add button is disabled only by the parent's `disabled` lock (the
daemon-overlay lock). It is mounted twice — workspace `ModelsSection` and daemon
`DaemonWorkerOptions` — so one fix covers both. `packages/ui` already depends on
`@agent-conductor/shared`. Tests live in `packages/ui/src/test/models.test.tsx`, which renders
`SettingsRoute` with the usual `../app/link` mock.

Zod is 3.25: `ZodString` exposes `.minLength` / `.maxLength` (`{ value, message } | null`) and
`_def.checks` for the regex, so both the helper and the derivation test can read live limits off
the schema.

## Goals / Non-Goals

**Goals:**

- A violation shows at its input while typing, before any submit.
- Add is unavailable while the entry would be rejected, available once it would be accepted.
- No limit is restated in the UI: a schema change the editor does not follow must fail a test.
- Server behavior untouched; the sibling sweep stated in the PR.

**Non-Goals:**

- No general form framework and no new dependency (no react-hook-form, no zod resolver): one
  small helper, as the ticket sizes it.
- Not converting the `useCommittableField` fields — different interaction (commit on Enter/blur
  with the result shown at the field, per `web-settings/field-commit`), already covered.
- Not touching the CLI's `models` command: the server still validates; the CLI prints the code.

## Decisions

1. **Validate the exact object the daemon would parse.** The editor builds the candidate option
   `{ id, description, runtime, model }` with the same trim `add()` applies today, runs it
   through `WorkerModelOptionSchema`, and runs the resulting array `[...options, candidate]`
   through the newly exported `WorkerOptionsArraySchema` — so duplicate ids and the 16-cap come
   from the same source as the server's, not from hand-picked field rules. Issues map by path:
   `[0, 'description']` → description field, `[0, 'id']` → id field; array-level issues
   (duplicate, cap) render on the id field's line. Runtime and model need no field of their own —
   the runtime is a select of known ids and the schema accepts any model string.

2. **Helper shape: pure function, React-free.** `parseFieldIssues(schema, value)` returns
   `{ valid, byPath }`, the first issue per top-level path, zod's message as the text, in
   `packages/ui/src/lib/schema-field.ts` with a colocated `.test.tsx` (the ui vitest include is
   `*.test.tsx` only). The editor maps a couple of terse zod messages to friendlier copy but
   reads any number in them (the 200) from the schema-derived limit, never a literal.

3. **A calm pristine form.** A violation only shows for a non-empty invalid field; empty fields
   simply keep Add disabled. A static hint line names the two required fields, so the disabled
   button is never unexplained. This replaces `add()`'s silent no-op on an empty form.

4. **Derivation test reads the limit off the schema.** The test computes the max via
   `WorkerModelOptionSchema.shape.description.maxLength!.value`, types one character past it
   (expects the field error and a disabled Add), then exactly at it (expects a clear field and an
   enabled Add). If the schema's max changes and the editor restates 200, that test fails — AC #3.
   The coupling to zod 3's accessor shape is acceptable: a zod upgrade breaks it loudly at
   typecheck, not silently.

5. **Add-project Max workers: validate the single field schema.** `parseFieldIssues` applied to
   `ProjectConfigSchema.shape.maxWorkers` — the number the form would send. Bounds derive from
   the schema (integer 1..32); the drifted HTML `max={16}` attribute is dropped. Add is disabled
   while the typed value is out of bounds; the error renders in the field's hint slot in the
   `text-failed` tone, the same placement the worker-options editor uses. The Git URL field stays
   as-is: its schema is `min(1)`, which the button's existing `!url` guard already enforces.

6. **Sibling sweep, decided up front (stated in the PR per AC #5):**
   - *Fixed here:* the two submit-style forms above — the only ones that could fire a
     schema-rejected write with no pre-submit feedback at the field.
   - *Already correct:* change-password disables submit until `next.length >= 8`, matching the
     server's `min(8)`; the `useCommittableField` fields commit explicitly and already surface a
     rejected save at the field per `web-settings/field-commit` (VS-141), several with their own
     client checks (workspace name non-empty, budgets integer ≥ min, project maxWorkers ≥ 1);
     allowlist coerces client-side; bot-token validation is Telegram's, external to any schema;
     everything else is enum-valued selects and toggles with nothing to violate.
   - *Noted, not fixed:* those committable fields restate their thresholds as literals
     (`min={500}`, `max={16}` HTML attrs) — drift-prone but commit-checked, so no rejected
     round-trip happens today. Converting all of them is a broader sweep than this ticket.

## Risks / Trade-offs

- Deriving from zod internals in tests couples them to zod 3's accessor surface — accepted in
  decision 4.
- Showing errors only once a field is non-empty keeps the pristine form silent; mitigated by the
  static required-fields hint (decision 3).
- `WorkerOptionsArraySchema`'s export widens `packages/shared`'s surface slightly; it is the
  package's own shape, already implied by `DaemonModelsSchema`, so no new contract.
