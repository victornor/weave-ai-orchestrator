## Context

See `proposal.md` - Why. The current state, confirmed by reading the code and by a throwaway-repo
experiment, not assumed:

- `scratchLandWorktree` (`packages/core/src/tickets/archive-before-merge.ts:28-47`) fetches
  `origin/<branch>`, adds a detached worktree at that commit, then runs `git checkout -B <branch>` in
  it. That last step exists only to give the scratch worktree a branch name to rebase, commit and push
  from; the push itself is already `HEAD:${branch}` (line 187), which does not need a local branch.
- Git refuses `checkout -B <branch>` while any other worktree of the repository has `<branch>` checked
  out, and the requesting worker's worktree (`workers/<id>/work`) normally does.
- Every later step in `attemptArchiveThenMerge` works against `HEAD`, not a branch name:
  `isFreshAgainstLanding(scratch.path, 'HEAD', landingRef)` (line 164), `rebaseOntoLanding` (line 166,
  which is `git rebase landingRef` on whatever `HEAD` is), and `archiveOnBranch` (line 179, `git add` +
  `git commit` on the worktree). The push is `HEAD:${branch}`. The merge runs through the forge against
  the PR URL, not a local ref.
- Verified in a scratch repository: a detached worktree rebases cleanly (`git rebase origin/main`
  reports "Successfully rebased and updated detached HEAD"), and
  `git push --force-with-lease origin HEAD:refs/heads/<branch>` updates the remote branch while the
  second worktree that holds it is left untouched.
- `scratchBranchFrom` (line 55) is a different function: `git worktree add -b <newBranch>` creates a
  brand-new branch no worktree holds, so it is not affected by this bug. It is not a caller of
  `scratchLandWorktree`.

## Goals / Non-Goals

**Goals:**
- Landing succeeds while the requesting worker's worktree holds the branch, with no change to the
  delivery policy, the merge-approval flow, or the observable archive-then-merge outcome.
- The worker's worktree is provably untouched by landing.

**Non-Goals:**
- Changing when archive-then-merge runs, what it archives, or how it merges.
- Adding branch-existence or `git worktree list` detection: the fix removes the operation that
  collides, rather than probing for a collision and branching around it.
- Changing `scratchBranchFrom` or the OpenSpec backfill path.

## Decisions

### Decision 1: Keep the scratch worktree detached; drop the `checkout -B`

The scratch worktree stays exactly as step 2 created it — detached at `origin/<branch>`. The failing
`git checkout -B <branch>` is removed, and nothing replaces it. Every step that follows is expressed
in terms of the worktree's `HEAD` or its path, so it is indifferent to whether that `HEAD` is on a
branch (audited in Context). Archiving, committing, rebasing and pushing a detached `HEAD` are all
ordinary git operations.

**Alternative considered: check out a unique throwaway branch name** (e.g. `ac-land-<tmp>`) in the
scratch worktree and push `refs/heads/ac-land-<tmp>:refs/heads/<branch>`. This also avoids the
collision, but it introduces a local branch that must be named uniquely and cleaned up, and it keeps
the misleading idea that the scratch worktree is "on" the ticket's branch. Detached `HEAD` is simpler
and is already the state the worktree starts in.

**Alternative considered: detach the worker's worktree to free the branch.** Rejected outright by the
ticket and by design: the worker's worktree may hold uncommitted state and the worker keeps using it
after landing. Landing must never mutate it.

**Alternative considered: run the sequence in the primary clone.** Rejected: the primary clone's own
checkout is the landing branch (VS-327 Decision 3), and the sequence must not disturb it; it is also
the shared checkout other project work uses.

### Decision 2: Push the detached HEAD with an explicit refspec and the existing lease

The push becomes `git push --force-with-lease origin HEAD:refs/heads/<branch>`. The refspec is explicit
(`refs/heads/<branch>`), so it can never be read as anything but the remote branch. `--force-with-lease`
still checks the remote branch against the remote-tracking ref `refs/remotes/origin/<branch>`, which
the function fetched at the top (`git fetch origin <branch>`) and which the local rebase does not move,
so the lease holds. `attemptArchiveThenMerge`'s initial `git fetch origin <landingBranch>` does not
touch `origin/<branch>`, so it does not disturb the lease either.

### Decision 3: `dispose()` is unchanged

Because no local branch is created, there is nothing to delete. `dispose()` already removes the
worktree, removes the directory and prunes; it keeps doing exactly that. This also satisfies the
"no stray local branch" cleanup requirement without adding a `git branch -D` to `scratchLandWorktree`
(which would be wrong for a future caller committing to an existing branch).

### Decision 4: The contract is documented for the VS-358 caller

`ScratchLand`'s doc comment currently says "a checkout of the ticket's branch". It becomes "a detached
worktree at `origin/<branch>`; commit in it and push `HEAD` to `refs/heads/<branch>`". The approved
VS-358 design names `scratchLandWorktree` for committing onto an existing `ac/knowledge-<slug>` branch,
which no worker holds; the detached contract serves that caller the same way — it never assumes a
local branch exists and never creates one.

## Risks / Trade-offs

- **[Risk] `--force-with-lease` refuses the push if the remote branch moved since the fetch.** → It
  already could, and should: force-with-lease is the safety that stops a stale local copy overwriting
  a newer remote one. The sequence fetches immediately before, so the only way the remote moves in
  between is a concurrent writer, which the project-scoped serializer already prevents for landing.
- **[Risk] A detached rebase leaves the scratch worktree without a branch, so a failed step cannot be
  inspected by branch name.** → The worktree is temporary and disposed in `finally`; nothing inspects
  it by branch name, and the current code never did either (`HEAD` was pushed).
- **[Trade-off] The empty commit case is unaffected.** `archiveOnBranch` already tolerates "nothing to
  commit" for a change whose archive folder is already gone; detached `HEAD` does not change that.
