## 1. Detached scratch landing worktree

- [x] 1.1 In `packages/core/src/tickets/archive-before-merge.ts`, remove the
  `git checkout -B <branch>` step from `scratchLandWorktree` so the worktree stays detached at
  `origin/<branch>`; update `ScratchLand`'s and `scratchLandWorktree`'s doc comments to the detached
  contract (commit in the worktree, push `HEAD` to `refs/heads/<branch>`).
- [x] 1.2 In `attemptArchiveThenMerge`, push with an explicit refspec —
  `git push --force-with-lease origin HEAD:refs/heads/<branch>` — and audit every step
  (`isFreshAgainstLanding(…, 'HEAD', …)`, `rebaseOntoLanding`, `archiveOnBranch`, the forge merge and
  `dispose`) for anything that assumes a local branch checkout; adjust each rather than recreating the
  branch locally.
- [x] 1.3 Update `rebaseOntoLanding`'s and `archiveOnBranch`'s doc comments where they say the worktree
  is "checked out" on a branch, so they describe the detached `HEAD` they now operate on.

## 2. Reproducing test and worktree-untouched assertion

- [x] 2.1 In `packages/core/src/tickets/archive-before-merge.test.ts`, add a test with a real temporary
  repo and remote: push the branch, then create a second worktree of the clone that checks the branch
  out (standing in for the worker's worktree), then call `scratchLandWorktree` +
  `attemptArchiveThenMerge`; assert the archive commit lands on the remote branch and the merge
  proceeds. Confirm this test fails on the pre-change code with "already used by worktree".
- [x] 2.2 In the same test, capture the second worktree's `HEAD`, branch and status before landing and
  assert they are identical after — the worker's worktree is never detached, reset or modified.
- [x] 2.3 Assert no local branch for the ticket's branch is created or reset by the scratch path, and
  that `dispose()` leaves no stray local branch and no scratch directory.
- [x] 2.4 Confirm the existing mechanics tests still pass unchanged: `scratchLandWorktree` leaves the
  clone alone, `dispose` is idempotent, `isFreshAgainstLanding`, `rebaseOntoLanding` (clean and
  conflict), `archiveOnBranch`, and every `attemptArchiveThenMerge` case (merge, archive-and-push,
  stale rebase, conflict, checks pending/failed, retry-after-pending).

## 3. Verification and knowledge

- [x] 3.1 `openspec validate vs-363-the-daemon-s-archive-then-merge-landing --json --strict` is clean.
- [x] 3.2 `pnpm lint` and `pnpm typecheck` are clean.
- [x] 3.3 `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run` separately;
  paste both suite blocks verbatim in the report and confirm both pass.
- [x] 3.4 Record the durable finding — the scratch landing worktree must stay detached because the
  requesting worker's worktree normally holds the branch — in the project knowledge base, linked from
  its hub or an existing document.
