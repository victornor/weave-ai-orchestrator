## Why

`workers/` in v-services holds 187 GB in 153 copies, 181 GB of them for `done`/`cancelled` tickets, and VS-859's sweep and VS-955's scan treat nearly all of them as unlanded. The landed test re-derives "landed" from git refs that we delete ourselves (VS-770 branch cleanup, VS-798 pruning) or rewrote (VS-776/VS-831). Its squash-merge fallback, `git cherry`, compares commits one at a time, so any squash of two or more commits can never match. Meanwhile the ticket already records what happened: `delivery.merged`, `delivery.prHead` and `delivery.mergeCommit`, written by `mergeDone` after it verified the landing.

Measured on disk on 2026-11-03, read-only: all 152 checkouts are clean (no tracked or untracked changes). Of the 106 FanStack copies, 101 have a squash commit on `origin/edge` that names their ticket and contains every file the copy changed, yet `git cherry` reports 2–25 commits missing for every one of them. One agent-conductor copy (VS-946) has HEAD equal to its recorded `prHead`. VS-340 is one of the 18 "branch not found" copies: it has a detached HEAD whose content is fully contained in its recorded merge commit `4b37832e`.

The ticket's second suspicion does not hold. The landed test already compares against `landingBranchOf(project, ticket)`, and FanStack's project declares `landingBranch: edge`. The comparison targets the right branch; the comparison method is what fails.

## What Changes

- The landed test asks the ticket first. A `done` ticket whose delivery records a merge proves the copy landed when the checkout's HEAD equals the recorded PR head or is an ancestor of it. Failing that, it proves the landing when every path the copy changed has identical content in the recorded merge commit, excluding what the daemon's own OpenSpec archive rewrites. No remote branch, local branch or ancestry against the landing branch is needed.
- The proof reads the checkout's own HEAD, so a copy whose branch was deleted from both the clone and the remote (detached HEAD) can still be proven.
- A copy with commits beyond what the recorded merge contains stays unlanded, and the extra commits are counted.
- A ticket that records a merge the copy cannot be checked against (no PR head or merge commit in the clone, or content differs only in ways the proof cannot attribute) gets its own verdict, `landing_unverified`. It is never reported as "N commits not contained".
- `git` ref tests stay as the fallback for tickets with no recorded merge (cancelled, never-merged, local-branch delivery without a record). Genuinely unlanded work stays unlanded, and nothing unlanded is removed without captain's approval.
- The proof applies to all three callers: retirement at terminal time (`retireIfLanded`), VS-859's sweep (`reclaimFinishedHomes`) and VS-955's scan (`retained.inspect`). Once retirement uses it, newly merged tickets retire immediately instead of adding to the pile.
- VS-955 gains the class and reason `landing_unverified`, shown in the Storage view and in `weave worker retained`. A copy the proof shows landed is no longer a retained copy. VS-859's sweep reclaims it automatically once it is past `workerArchiveDays`, under the existing landed-and-clean rule.
- VS-859's sweep can remove a proven copy whose branch is gone (detached HEAD) by path, keeping `deleteBranch: false`.

## Capabilities

### New Capabilities
- `worker-landing-proof`: how the daemon decides that a finished worker copy's committed work landed, using the ticket's recorded merge first and git refs as the fallback, and the `landing_unverified` verdict.

### Modified Capabilities
- `worker-home-retention`: "Nothing unprovably landed is deleted" now accepts the recorded-merge proof, including for a copy whose branch is gone.
- `worker-retained-copies`: adds the `landing_unverified` reason and class. A copy proven landed is not a retained copy.
- `worker-supervision/terminal-retirement`: retirement treats commits covered by the ticket's recorded merge as landed.

## Impact

- `packages/core/src/worktrees/landed.ts`: the recorded-merge proof, and `landedWorkTest` taking the ticket's delivery and OpenSpec change name.
- `packages/core/src/workers/index.ts`: `retireIfLanded` and `reclaimFinishedHomes` pass the delivery; the sweep removes branch-gone copies by path.
- `packages/core/src/workers/retained.ts`: the scan uses the same proof and assigns the new class.
- `packages/shared/src/enums.ts`: `RETAINED_COPY_CLASSES` and `RETAINED_COPY_REASONS` gain `landing_unverified`.
- `packages/ui/src/v2/settings/sections/Storage.tsx`, `packages/cli/src/commands/worker.ts`: label the new class.
- Docs: `docs/OPERATIONS.md` → "Disk fills up".
- No schema migration, no new API route, and no change to who may approve a reclaim.
