## 1. Shared schema export

- [x] 1.1 In `packages/shared/src/config.ts`, add `export` to the module-local `WorkerOptionsArraySchema`. No shape change; confirm it flows through the package's existing config re-exports (`packages/shared/src/index.ts`).

## 2. Shared helper

- [x] 2.1 Add `packages/ui/src/lib/schema-field.ts`: `parseFieldIssues(schema, value)` returning `{ valid, byPath }` — first zod issue per top-level path (array-index paths mapped to their field), zod's message as the text. Pure, React-free.
- [x] 2.2 Add `packages/ui/src/lib/schema-field.test.tsx` (ui vitest include is `*.test.tsx` only): over-length string, slug-regex rejection, array duplicate-id and cap issues mapped to fields, valid input passes.

## 3. Worker-options editor

- [x] 3.1 In `Settings.tsx`'s `WorkerOptionsEditor`: build the trimmed candidate `{ id, description, runtime, model }`; field errors from `WorkerModelOptionSchema` via the helper; array rules from the exported `WorkerOptionsArraySchema` over `[...options, candidate]`. Violations render in the offending `Field`'s hint slot in the `text-failed` tone while typing. Add is disabled unless the candidate and the resulting array both parse (in addition to the parent's lock); `add()`'s silent empty-form no-op goes away.
- [x] 3.2 Add a static hint naming the two required fields, so a pristine disabled form is explained.

## 4. Add-project Max workers

- [x] 4.1 In `Settings.tsx`'s `ProjectsSection`: validate Max workers against `ProjectConfigSchema.shape.maxWorkers` via the helper; error at the field while typing; Add disabled while out of bounds; drop the drifted `max={16}` HTML attribute.

## 5. Tests

- [x] 5.1 `packages/ui/src/test/models.test.tsx`: typing a description one character past the limit derived from `WorkerModelOptionSchema.shape.description.maxLength` shows the error at the field and disables Add; typing exactly the limit clears it and enables Add; shortening after the error clears it. The test must fail if the editor restates the limit as a literal.
- [x] 5.2 `models.test.tsx`: a non-kebab id and a duplicate id each show at the id field with Add disabled; a catalog already at the schema's cap shows the cap and disables Add regardless of the typed entry.
- [x] 5.3 The add-project suite: out-of-bounds Max workers (e.g. 0 and 33) shows the error at the field and disables Add; a value at the schema's maximum submits.
- [x] 5.4 The existing "adding one PUTs the full block (VS-162)" case still passes unmodified, showing the valid path and the server contract are unchanged.
- [x] 5.5 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all green (run the ui suite via the root command; `pnpm typecheck` includes the `tsc -b` first).

## 6. Delivery

- [x] 6.1 PR description states the sibling sweep per design.md decision 6: change-password parity (client 8 = server `min(8)`), committable fields already showing rejected saves at the field per `web-settings/field-commit`, enum-valued controls with nothing to violate, and the noted-not-fixed literal thresholds in committable fields.
