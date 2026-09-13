## Why

Archive-then-merge (VS-327) fails for any ticket whose worker worktree still has the branch checked
out. `scratchLandWorktree` (`packages/core/src/tickets/archive-before-merge.ts:32-35`) detaches a
scratch worktree at `origin/<branch>` and then runs `git checkout -B <branch>` in it; git refuses
that whenever another worktree of the same repository already has `<branch>` checked out. The worker
requesting landing normally still holds it, so the daemon's own landing rejects with
`'<branch>' is already used by worktree` and the ticket has to be blocked by hand (VS-357 incident
`01M2EAXVEKJXMX74P80T9P4JTH`).

## What Changes

- **Land without ever checking out the ticket's branch.** Keep the scratch worktree detached at
  `origin/<branch>` and run the freshness check, rebase, archive and archive commit against that
  detached `HEAD`. Never create, check out or reset a local branch for the ticket.
- Push the detached `HEAD` to the remote branch by explicit refspec
  (`HEAD:refs/heads/<branch>`), keeping the force-with-lease semantics the post-rebase push needs.
  The remote-tracking ref the lease checks is still the one the sequence fetched at the start.
- **Never touch the worker's own worktree** — not to detach it, not to free its branch. It may hold
  uncommitted state and the worker keeps using it after landing.
- Keep `ScratchLand`'s contract usable for the future caller named in the approved VS-358 design
  (committing onto an existing `ac/knowledge-<slug>` branch, which no worker holds): a detached
  worktree you commit in and push to the named branch.
- Update the tests: reproduce the failure with a real temporary repo and remote where a second
  worktree holds the branch, and assert the worker's worktree keeps the same HEAD, branch and status.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `ticket-delivery/archive-before-merge`: adds that the landing sequence performs its archive,
  rebase and push against the ticket's remote branch without any local checkout of it, and never
  modifies another worktree — in particular the requesting worker's.

## Impact

- `packages/core/src/tickets/archive-before-merge.ts` — `scratchLandWorktree` (drop the
  `git checkout -B` step; update the `ScratchLand` contract docs), `rebaseOntoLanding` docs, and the
  push refspec in `attemptArchiveThenMerge`. `scratchBranchFrom` is unchanged — it creates a brand-new
  branch no worktree holds.
- `packages/core/src/tickets/archive-before-merge.test.ts` — a new reproducing test plus an assertion
  that a second (worker-like) worktree is left untouched; existing tests keep passing.
- No change to the delivery policy, the merge-approval flow, the HTTP/MCP surface, or the database.
