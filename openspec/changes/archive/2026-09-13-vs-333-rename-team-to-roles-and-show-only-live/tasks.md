# Tasks

## 1. The landed-work test distinguishes leftovers from real changes

- [x] 1.1 In `packages/core/src/worktrees/landed.ts`, run `git status --porcelain -z
      --untracked-files=all`, split entries into untracked (`??`) and modified/staged tracked
      changes, and add `untrackedFiles: string[]` to `LandedVerdict`. Untracked-only dirt must
      fall through to the committed-work checks instead of returning not-landed; tracked changes
      keep the existing `N uncommitted change(s)` refusal. Verify with updated
      `packages/core/src/worktrees/worktrees.test.ts` cases: untracked-only on a landed branch
      returns `landed: true` and lists the files; a modified tracked file returns `landed: false`
      with the existing reason.

- [x] 1.2 Verify `unlandedCommitCount` and the `landedWorkTest` callers still behave by running
      `./node_modules/.bin/vitest run packages/core/src/worktrees` and pasting the result.

## 2. Retirement keeps untracked files and records why a worker is kept

- [x] 2.1 In `packages/core/src/workers/index.ts` `retireIfLanded`, on a landed verdict with
      `untrackedFiles`, copy each file from the worktree to
      `<ctx.paths.archive>/<workerId>/untracked/<relative path>` (creating parent directories)
      before removing the worktree; remove with `force: true` only when such files were copied.
      Archive the worker home by merging into the existing `archive/<workerId>` directory
      (copy-then-remove) when it already exists, keeping the rename path otherwise. Verify in
      `packages/core/src/workers/workers.test.ts`: an untracked-only landed worker retires, its
      worktree is gone, each file exists under `archive/<workerId>/untracked/`, and
      `archive/<workerId>/brief.md` is still present.

- [x] 2.2 Before removing the worktree, re-read the porcelain classification and refuse the
      retirement (recording the reason, worktree kept) if a tracked modification has appeared since
      the verdict. Verify with a workers test that a tracked change introduced after the verdict
      keeps the worker and leaves the worktree.

- [x] 2.3 On every refused `retireIfLanded`, write the verdict reason to the worker's `errorText`
      (without changing its `done` status) so the Roles page can show it. Verify with a workers
      test that a worker kept for an unlanded commit carries that reason.

- [x] 2.4 When a retirement archives untracked files, leave a rescue trail before the archive is
      pruned: a system comment on the worker's ticket listing the relative paths (first 50, then
      `and N more`) and the same capped list in the `worker.retire` activity payload. Verify with a
      workers test that archives several files and asserts the ticket comment and the activity
      payload both name them, and that more than 50 files are capped with a count.

## 3. A terminal ticket's stale pull-request record is refreshed from the forge

- [x] 3.1 In `retireIfLanded`, when the ticket is `done` or `cancelled` and its `pull_request` work
      product is not recorded as merged, call the `github` forge's `prState` at the project's clone
      path; on a merged answer update `ticket_work_products.state` and pass `mergedPr: true` to the
      landed test. Throttle the call to at most once per worker per hour (in-memory map keyed by
      worker id, stamped alongside the worktree's `lastVerifiedAt`) and use the stored record
      between checks. Verify with a workers test using a fake forge returning `merged` for a
      squash-merged PR whose stored state was `open`: the worker retires and the row reads merged;
      and a second test where two retire attempts inside the window make exactly one `prState`
      call.

- [x] 3.2 Make a forge error or an unresolvable pull request fall back to the stored record
      (unchanged) with no throw. Verify with a workers test where `prState` rejects: the decision
      uses the stored evidence and the retirement outcome is unchanged.

## 4. Rename the Team page to Roles

- [x] 4.1 Rename `packages/ui/src/routes/Team.tsx` to `Roles.tsx` (`TeamRoute` → `RolesRoute`,
      page title `Roles`), and update its import and route in `packages/ui/src/router.tsx`. Verify
      `pnpm --filter @weave-ai/ui typecheck` (or the root `pnpm typecheck`) is clean.

- [x] 4.2 In `router.tsx`, register `/w/$ws/roles` as the page and make `/w/$ws/team` a route whose
      `beforeLoad` throws a redirect to `/roles` for the same workspace. Verify with a route test
      that visiting `/w/alpha/team` lands on the Roles page with `ws=alpha`.

- [x] 4.3 Update `packages/ui/src/app/nav.ts` (rail key/label and the phone tab), the rail comment,
      `packages/ui/src/routes/GlobalMap.tsx`, `packages/ui/src/lib/map/model.ts`,
      `packages/ui/src/routes/WorkerPage.tsx` (`Back to Roles`, `/roles`) and the
      `packages/ui/src/routes/Live.tsx` copy to say Roles. Verify
      `packages/ui/src/test/workspacenav.test.tsx` expects `Roles` and a new/updated test asserts
      the worker page back link and the map role action address `/roles`.

## 5. The Roles page shows live instances and the finished-work-kept group

- [x] 5.1 In `Roles.tsx`, list only live workers (`provisioning`, `active`, `running`, `paused`,
      `error`) under each role, and count the live set in the header meta. Verify with a
      `roles.test.tsx` case: with live and `done` workers for one role, only the live ones render
      and the meta reads the live count.

- [x] 5.2 Render a `Finished, work kept (N)` group under a role for each `done` worker with an
      `errorText` reason, showing the reason; render no group when the set is empty. Verify with
      `roles.test.tsx` cases asserting the group heading, the count and the reason, and its absence
      when a role's finished workers have landed.

- [x] 5.3 Rename `packages/ui/src/test/team.test.tsx` to `roles.test.tsx`, update its import and
      `TeamRoute`/`Team` references, and run
      `pnpm --filter @weave-ai/ui exec vitest run src/test/roles.test.tsx` green.

## 6. Docs

- [x] 6.1 Update `docs/PLAN.md` where it describes the current view to name it Roles (the org view,
      the UI checklist line and the acceptance line), leaving the historical change log untouched.
      Verify by re-reading the three lines.

## 7. Full verification and delivery

- [x] 7.1 Run `pnpm lint && pnpm typecheck` and both test suites
      (`pnpm test`), and paste both suite blocks verbatim in the delivery comment.
- [x] 7.2 Open the PR for `ac/vs-333-rename-team-to-roles-and-show-only-live` and record it as a
      work product on the ticket.
