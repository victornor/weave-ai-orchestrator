# Tasks

## 1. Opt-in multi-line commit handling

- [x] 1.1 Add a `multiline` opt-in to `useCommittableField` (`packages/ui/src/lib/commit-field.ts`): when set, a plain Enter neither commits nor `preventDefault`s (the textarea inserts a line break) and Cmd/Ctrl+Enter commits; the default stays save-on-Enter for every other field.
- [x] 1.2 Cover it directly in `packages/ui/src/lib/commit-field.test.tsx`: multi-line plain Enter does not commit, Cmd/Ctrl+Enter commits, blur still commits, and a default (single-line) field still commits on plain Enter.

## 2. Both "When to use" fields become text areas

- [x] 2.1 Option row (`WorkerOptionRow` in `packages/ui/src/routes/Settings.tsx`): swap the `<input>` for a `<textarea>` styled like the existing Settings text area, pass `multiline: true` to the hook, and keep the label, `aria-label`, character-count hint, error display and `CommitStatus`.
- [x] 2.2 Add form (`WorkerOptionsEditor`): swap the "New worker option description" `<input>` for the same styled `<textarea>`, keeping its label, `aria-label` and error display.

## 3. Tests and schema confirmation

- [x] 3.1 `packages/ui/src/test/models.test.tsx`: Enter adds a newline in the option row without saving, Cmd/Ctrl+Enter and blur save, a multi-line value round-trips through the save, and the add-form description is a text area. Update the existing VS-299 Enter-to-save cases to the new gesture.
- [x] 3.2 Assert in `packages/shared/src/config.test.ts` that `WorkerModelOptionSchema.description` accepts a value containing a newline (and still enforces the 200 cap).
- [x] 3.3 Confirm a different single-line committable field still saves on plain Enter (covered at the hook level in 1.2).

## 4. Verify and deliver

- [x] 4.1 `pnpm lint` and `pnpm typecheck` green.
- [x] 4.2 Full `pnpm test`: both suite blocks green, totals pasted verbatim on the ticket.
- [x] 4.3 Open the PR and transition to `in_review`.
