## 1. The shared commit primitive

- [x] 1.1 Add `packages/ui/src/lib/commit-field.ts` exporting `useCommittableField({ value, onCommit })`
      returning `{ draft, status, error, onChange, onBlur, onKeyDown, commitNow }` per design.md's
      Decisions. Cover with a unit test (fake `onCommit`) that: `onChange` moves `idle → dirty`; a
      resolved `commitNow()`/Enter/blur moves `dirty → saving → saved`, and `saved` reverts to `idle`
      after its delay; a rejected commit moves to `error` with the rejection's message and leaves
      `draft` unchanged; `value` changing externally while `status` is `idle` updates `draft`, but not
      while `dirty` or `saving`.
- [x] 1.2 Add a unit test for the unmount-flush behavior: a dirty field that unmounts calls `onCommit`
      with the current draft exactly once, without awaiting it.
- [x] 1.3 Add `CommitStatus` (in the same module or a small companion component file) rendering nothing
      for `idle`, an unsaved indicator for `dirty`, a saving indicator for `saving`, a transient saved
      indicator for `saved`, and an error message plus a retry-shaped save action for `error`; render an
      explicit save action (calling `commitNow`) whenever `status` is not `idle`/`saved`. Verify with a
      component test covering each status.

## 2. Workspace name and knowledge budgets

- [x] 2.1 In `WorkspaceSection` (`Settings.tsx:196-208`), move the Name field onto
      `useCommittableField` (`onCommit` calls `patch.mutateAsync({ name })`), render `CommitStatus`
      beside it, and keep `Enter` and blur both committing.
- [x] 2.2 In `KnowledgeBudgetsSection` (`Settings.tsx:273-318`), move each `BUDGET_FIELDS` entry and the
      bootstrap-digest field onto the same hook; `onCommit` parses and validates (integer, `>= 500`)
      and rejects with a message when invalid instead of today's silent no-op, then calls
      `patch.mutateAsync(...)`.
- [x] 2.3 Test (`Settings.test.tsx`): editing the Name field and unmounting `WorkspaceSection` without
      blurring still sends the patch; an out-of-range budget value shows the rejection message and
      keeps the typed number in the field.

## 3. Project rows: `maxWorkers` and `landingBranch`

- [x] 3.1 In `ProjectsSection` (`Settings.tsx:377-408`), move the per-project `maxWorkers` and
      `landingBranch` inputs onto `useCommittableField`; `landingBranch`'s `onCommit` keeps trimming and
      sending `{ landingBranch: value }`, and on rejection keeps the typed text and shows the daemon's
      error message inline instead of resetting `e.target.value` to the prior value (removes the
      revert-on-error behavior the ticket calls out).
- [x] 3.2 Test: setting a project's landing branch, unmounting the row's field without blurring
      (e.g. the projects list re-rendering) still sends the patch; a rejected landing-branch save (branch
      not found) keeps the typed branch name visible with the error, rather than reverting to the prior
      value or to empty.

## 4. Model free-text id and Telegram allowlist

- [x] 4.1 In `ModelSettingFields` (`Settings.tsx:508-538`), move the free-text model id input onto
      `useCommittableField`, keeping its existing `Enter`-triggers-commit behavior (now via the hook's
      `onKeyDown` rather than `e.currentTarget.blur()`).
- [x] 4.2 In `ChannelsSection` (`Settings.tsx:620-635`), move the Telegram allowlist input onto the same
      hook; `onCommit` keeps the existing comma-split/`Number`/`Number.isInteger` filtering before
      calling `patch.mutateAsync`.
- [x] 4.3 Test: the model id field commits on `Enter` without needing a blur; the allowlist field shows
      "unsaved" while dirty and "saved" once the patch resolves.

## 5. Cross-cutting verification

- [x] 5.1 `Settings.test.tsx` case per ticket AC #6, phrased as the ticket describes it: a value survives
      an edit followed by an unmount with no explicit blur, for at least one field of each input shape
      (text and number).
- [x] 5.2 Confirm no field named in proposal.md - Impact still uses a bare `onBlur={() =>
      mutate(...)}` with no visible status — a repo grep for the pattern in `Settings.tsx` after this
      change should return none of the seven.
- [x] 5.3 Reproduce the original bug first and record how: at a phone viewport width in a real browser
      (not jsdom), type into the landing-branch field and reload without tapping elsewhere; confirm on
      `main` the value is lost. Repeat against this change's build and confirm the field either kept the
      value or visibly showed it as unsaved before the reload. State both results in the PR per the
      ticket's Verification section.
- [x] 5.4 `pnpm typecheck && pnpm lint && pnpm test` green.

## 6. Docs

- [x] 6.1 No `docs/API.md`/`docs/PLAN.md` change expected (no route or CLI surface changes) — confirm
      this remains true once the above lands, since the change is client-only.
