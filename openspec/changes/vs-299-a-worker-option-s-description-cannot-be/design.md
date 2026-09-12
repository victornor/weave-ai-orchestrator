## Context

The worker-option catalog is edited in one shared React component, `WorkerOptionsEditor`, reused by
the workspace Models section (`Settings.tsx:814`) and the daemon Models section (`DaemonWorkerOptions`,
`Settings.tsx:1390`). Each option is the same `WorkerOptionRow`. Today that row shows
`{option.id} — {option.description}` as static text and its `patch()` only ever clears the runtime's
model, so the description is frozen after the add form.

The add form already validates an entry against `WorkerModelOptionSchema` /
`WorkerOptionsArraySchema` via `parseFieldIssues` and derives the cap from
`WorkerModelOptionSchema.shape.description.maxLength` (`:1162`) — the pattern to reuse, not
re-derive.

The existing save path replaces the whole catalog (`onSave({ ...current, workerOptions:
options.map(...) })`) and is already validated by `WorkerOptionsArraySchema`'s `superRefine` on the
server. A description edit needs no new write.

## Goals / Non-Goals

**Goals**

- Make an existing option's description editable in place in both catalog surfaces, reusing
  `useCommittableField` (VS-141) and the existing whole-catalog save.
- Keep the id structurally immutable — no id input on an existing row.
- Make the character cap visible and refuse an over-length/empty description with a stated reason
  before the catalog is sent.

**Non-Goals**

- Changing the 200-character cap, or any stored schema.
- Changing `weave_worker_models`, dispatch, or tier-selection logic.
- Retiring/reconciling `workerModelId` values already recorded on tickets.
- Fixing the pre-existing drop of a stored `effort` when the runtime select is changed (a separate
  bug, not this ticket's acceptance).

## Decisions

**Reuse `useCommittableField` for the new field.** It already provides exactly what
`web-settings/field-commit` requires of a Settings text field: an `Enter`/Save/blur/unmount commit,
a visible unsaved/saving/saved/error state, and a rejected save that keeps the typed draft. Rolling a
second inline-edit mechanism would duplicate that contract. Rejected alternative: committing on each
keystroke like the selects do — it would PUT per character and lose the required save state.

**`onSave` becomes promise-returning.** `useCommittableField.onCommit` is async so a daemon rejection
can be shown on the field. `WorkerOptionRow.patch` currently drops the return value of `onSave`, and
both call sites call `save.mutate` (void). Change the prop type to
`(next: T.WorkspaceModels) => Promise<void> | void`, have `patch` return it, and switch the two call
sites to `save.mutateAsync(...)`. Existing select onChange handlers ignore the returned promise, so
their behavior is unchanged.

**Cap and validation derived from the shared schema.** `descMax = WorkerModelOptionSchema.shape
.description.maxLength` (same expression the add form uses). The field renders a live `N/descMax`
hint and, while the trimmed draft exceeds it, the same `At most N characters — now M.` copy the add
form uses. `onCommit` rejects empty and over-length drafts before calling `patch`, so the catalog is
never sent invalid and no text is silently truncated. A live in-component error is shown while
typing; the commit-time rejection is the backstop.

**Id immutability by omission.** The row renders the id as its heading and adds no id input. This is
stronger than disabling an input: there is no control whose state could be edited or submitted.

**Both surfaces, one write each.** Because the row is shared, the workspace catalog and the daemon
catalog overlay both gain the edit. Each commits through its own existing save
(`PUT /models` for the workspace's own catalog, `PUT /api/daemon/models` for the overlay); VS-284's
precedence is untouched, and no cross-writing is introduced.

## Risks / Trade-offs

- A dirty description draft is not itself folded into an unrelated save: changing the runtime while a
  description draft is uncommitted saves the runtime patch built from the *stored* option, leaving the
  draft to commit on blur/unmount. This matches how every other committable field behaves and the
  draft is not lost; it is noted so it is not mistaken for a regression.
- `WorkerOptionRow`'s existing runtime `patch` builds a fresh object `{ id, description, runtime,
  model }` that drops `effort`. Out of scope here; the new description path uses `{ ...option,
  description }`, so it preserves effort as the acceptance requires.

## Migration Plan

No data migration. The web app is served by the daemon; the change ships with the normal build. An
edit writes the same catalog shape it always did. Rollback is a build revert; already-saved
descriptions are plain catalog data.

## Open Questions

None. The ticket resolved the surface (both, shared row), the immutability mechanism (no id input),
and the cap handling (visible, refused before save).
