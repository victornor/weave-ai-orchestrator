## 1. Service layer: validate and clear in `projects.update()`

- [x] 1.1 In `packages/core/src/projects/index.ts`, add a helper that checks a branch exists on
      `origin` in a project's `clonePath` (`git rev-parse --verify --quiet origin/<branch>`, mirroring
      `resolveBaseRef` but rejecting instead of falling back), and verify it with a unit test against a
      fake git repo: existing branch resolves, missing branch does not.
- [x] 1.2 In `update()`, when `patch.landingBranch` is a non-empty string, run that check before writing
      and throw `OcError('validation', ...)` naming the branch when it fails; when it is `''`, write
      `null` and skip the check; when it is `undefined`, leave the existing value untouched (already the
      case). Verify with `packages/core/src/projects/*.test.ts` cases: set to an existing branch
      succeeds and is readable via `get()`, set to a missing branch is rejected and the stored value is
      unchanged, set `''` after a prior value clears it back to `null`.
- [x] 1.3 Verify a cleared or changed `landingBranch` is visible to `landingBranchOf()` on the very next
      call with no daemon restart — a test that updates a project mid-test and asserts the next
      resolution (e.g. through `packages/core/src/tickets/land.ts`'s effective-landing-branch lookup, or
      a direct `projects.get()` re-read) reflects the change.

## 2. CLI: `conductor project set-landing-branch`

- [x] 2.1 Add `set-landing-branch <id> [branch]` to `packages/cli/src/commands/project.ts`, with a
      `--clear` flag; error out (no request sent) if neither `branch` nor `--clear` is given, and if
      both are given. Sends `PATCH /projects/:id` with `{ landingBranch: branch ?? '' }`.
- [x] 2.2 On success, print the project's landing branch in effect afterward (the new branch, or "using
      default branch `<defaultBranch>`" when cleared) and a one-line note that it applies to the next
      ticket action, no restart needed.
- [x] 2.3 On a validation rejection (branch not found), print the daemon's error message and exit
      non-zero, matching the CLI's existing error-printing convention (`OcError` code + message).
- [x] 2.4 Test the command against a fake server (or the existing CLI test harness pattern for
      `project set-policy`): set, change, clear, and the not-found rejection all round-trip correctly.

## 3. Web app: Settings page field

- [x] 3.1 In `packages/ui/src/routes/Settings.tsx`'s `ProjectsSection`, add a text input for
      `landingBranch` to each project's row, following the existing `maxWorkers` input's structure
      (value from the project, `onBlur` calls `usePatchProject().mutate({ id, patch: { landingBranch:
      value } })`, empty value sends `''`).
- [x] 3.2 Give the input a `placeholder` of the project's `defaultBranch` when `landingBranch` is empty,
      so the field always shows which branch is in effect, and a label distinguishing it from
      `defaultBranch`.
- [x] 3.3 Surface a validation rejection (branch not found) as visible feedback on that row rather than
      a silently failed mutation — reuse whatever error path `usePatchProject`'s other callers already
      rely on (e.g. a toast, or an inline message), matching the existing pattern rather than inventing
      a new one.
- [x] 3.4 Add or extend a `Settings.test.tsx` case: setting, changing and clearing the field round-trips
      through `usePatchProject`, and a rejected patch surfaces its error without clearing the displayed
      value.

## 4. Docs

- [x] 4.1 Add `conductor project set-landing-branch <id> [branch] [--clear]` to the CLI command table in
      `docs/PLAN.md` §20, next to the existing `project list|show|remove|fetch|set-policy` line.
- [x] 4.2 Note in `docs/API.md`'s `PATCH /projects/:id` entry that an empty-string `landingBranch`
      clears it, and that a non-empty value is validated against the project's remote at set-time.

## 5. Verification

- [x] 5.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 5.2 Confirm in the PR description the exact steps to set Fernwood's landing branch to `edge`
      (the CLI command and/or the Settings field), per the ticket's Verification section.
