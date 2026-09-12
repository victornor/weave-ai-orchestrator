## 1. Make the row's description editable

- [x] 1.1 In `WorkerOptionsEditor`'s `WorkerOptionRow` (`packages/ui/src/routes/Settings.tsx`), replace the static `{option.id} — {option.description}` heading with `{option.id}` plus a new description field labeled "When to use" and `aria-label={`${option.id} description`}`. Back it with `useCommittableField({ value: option.description, onCommit })` so it commits on Enter, Save, blur and unmount, and renders `CommitStatus`. The field renders no id input and no id control. Verify by a UI test that the row shows an editable description box and no id input.
- [x] 1.2 Derive `descMax` from `WorkerModelOptionSchema.shape.description.maxLength` (the same expression the add form uses at `:1162`) and render a live `N/descMax` hint. Show the add form's `At most ${descMax} characters — now ${len}.` copy while the trimmed draft exceeds it. In `onCommit`, reject an empty description (`throw new Error('A when-to-use description is required')`) and an over-length one before calling the save, so an invalid catalog is never written. Verify an over-length draft shows the limit and the commit is refused while the typed value is kept.
- [x] 1.3 Make `patch`, `WorkerOptionRow.onSave` and `WorkerOptionsEditor.onSave` return what `onSave` returns (`Promise<void> | void`), and switch both call sites — `ModelsSection` (`onSave={(next) => save.mutateAsync(next).then(() => undefined)}`) and `DaemonWorkerOptions` (`save.mutateAsync(...)`) — so a rejected daemon save surfaces on the field. Verify `pnpm --filter @weave-ai/ui exec vitest run src/test/models.test.tsx` still passes, adding `mutateAsync` to the daemon-save mock if it is not already there.

## 2. Cover the behavior

- [x] 2.1 Add a test that edits an existing option's description, commits it, and asserts the saved catalog carries the new description with id, runtime, model and effort unchanged. Verify it fails before 1.1 and passes after.
- [x] 2.2 Add a test that an over-length description is flagged with the schema's own limit while typing and the commit does not save; shorten it and assert the commit succeeds with the corrected text. Compute the limit from `WorkerModelOptionSchema.shape.description.maxLength`, as the existing add-form tests do, so a schema change the editor does not follow fails the test.
- [x] 2.3 Add a test that changing an option's runtime or model leaves its stored description unchanged (the round-trip in both directions), and that the description edit leaves runtime/model intact.
- [x] 2.4 Add a test that the daemon Models surface offers the same editable description on its catalog rows (the shared row), saving through the daemon catalog write.

## 3. Verify and deliver

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and both `pnpm test` suite blocks (core/server and UI), paste both blocks verbatim in the delivery report, and open the PR.
