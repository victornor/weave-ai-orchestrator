## Context

See proposal.md (Why). Three callers ask "did this copy land?":

| Caller | When | What it does today |
|---|---|---|
| `retireIfLanded` (workers/index.ts) | ticket goes terminal; every supervisor tick for `done` workers | `landedWorkTest` with `mergedPr` from the PR work product (refreshed from the forge); on a merged PR it still requires ancestry or `git cherry` against `origin/<landing>` |
| `reclaimFinishedHomes` (VS-859) | daily retention pass, past `workerArchiveDays` | trusts a `merged` PR work product outright; otherwise `landedWorkTest` |
| `retained.inspect` (VS-955) | daily scan | `commitsNotIn` (ancestry, then `git cherry`) unless a `merged` PR work product exists; `branch_gone` when the recorded branch is missing |

What the measurement (2026-11-03, disk only, read-only) showed:

- `git cherry <landing> <branch>` reports a commit missing whenever the squash combined it with any other commit. 101 of 106 FanStack copies are squash-merged to `edge` with all their content present, and cherry fails on every one.
- The PR work product's `state` is often stale `open` (VS-946's delivery says `prState: open` next to `merged: true`), so the "merged PR work product" shortcut misses as well.
- `tickets.delivery` on a done ticket holds `merged: true`, `mergeCommit`, `landedOn`/`landedSha` and, on newer deliveries (not VS-340's from 2026-09-13), `prHead`. `mergeDone` writes it after it has verified the landing on the forge and in the clone (`landed: "origin/main contains merge commit …"`).
- The 18 "branch not found" copies are agent-conductor checkouts from 2026-09-13…14 on a detached HEAD whose branch is gone from the clone and the remote. Their objects are still in the clone because a linked worktree's HEAD is a reachability root. VS-340's HEAD content is fully contained in its recorded merge commit.
- The landing branch is already the right one. FanStack declares `landingBranch: edge`, and `landingBranchOf` already resolves it.

## Goals / Non-Goals

**Goals:**
- One proof function used by all three callers, so retirement, the sweep and the Storage view always agree.
- Prove landings from the ticket's record and the checkout's own HEAD, without any branch ref.
- Make "merge recorded but not checkable" a visible class of its own.

**Non-Goals:**
- No new deletion path. Approval rules, `force` flags, `deleteBranch: false` and the age windows are unchanged.
- No change to VS-770 branch cleanup. Keeping branches only to serve as evidence is the wrong fix.
- No forge calls in the scan. The proof reads the database and the local object store only.
- No backfill of `prHead` into old deliveries.

## Decisions

### D1. The proof order: recorded PR head, then recorded merge commit content, then git refs

`recordedLandingProof({ clone, worktree, head, delivery, changeName })` in `worktrees/landed.ts` returns `landed` | `unlanded(n)` | `unverified(reason)` | `none` (no merge recorded):

1. **No record.** If `delivery?.merged !== true`, return `none`, and the caller falls through to today's git tests unchanged.
2. **PR head.** If `delivery.prHead` resolves in the clone and `merge-base --is-ancestor HEAD prHead` succeeds (equality included), the copy is landed: every commit it holds was in the PR that merged. If `prHead` resolves but HEAD is not its ancestor, count `rev-list prHead..HEAD`. Those are commits made after the merge, so the verdict is `unlanded(n)`, unless step 3's content check shows them already contained.
3. **Merge commit content.** If `delivery.mergeCommit` (else `delivery.landedSha`) resolves in the clone, the copy is landed when either check passes:
   - HEAD is an ancestor of it (merge-commit or fast-forward delivery);
   - every path HEAD changed since `merge-base(HEAD, mergeCommit^1)` has the same blob, or is absent in both, at the merge commit. The ticket's own `openspec/changes/<change>/` and `openspec/specs/` are excluded because the daemon's archive moves and rewrites them in the merged result.
4. **Otherwise** `unverified`, with a reason naming what was missing (no head or merge commit in the clone, or which paths differ).

*Why not trust `merged: true` alone, as the ticket suggests?* A worker can commit after its merge, for example a reply that reopens the ticket on the same branch. A bare flag would discard those commits silently. The head and content checks cost two git calls and catch exactly that case.
*Why not `git cherry` or a combined patch-id?* Per-commit patch-ids cannot match a multi-commit squash. A combined patch-id breaks when the landing branch moved between rebase and merge, and when the archive commit is folded into the squash. Comparing final content of only the copy's own paths is robust to both. It also fails safe: a difference makes the verdict `unverified`, never landed.
*Why the clone and not the forge?* PR heads and merge commits were pushed from or fetched into the clone, so the objects are local. The pre-rewrite objects for the 18 branch-gone copies are still there, which the measurement confirmed for VS-340. The scan stays offline and cheap.

### D2. HEAD, not the branch name

The proof reads `git rev-parse HEAD` in the checkout. A branch deleted from the clone and the remote therefore no longer makes a copy unprovable. `landedWorkTest` keeps the branch for the ref fallback only.

### D3. Where each caller plugs in

- `landedWorkTest` gains optional `delivery` and `changeName` inputs. After the uncommitted-changes check, and before the branch lookup, it runs D1. `landed` returns `landed: true` with `proof: 'recorded_merge'` evidence. `unlanded(n)` returns `N commit(s) were made after the recorded merge`. `unverified` returns `landed: false` with `unverified: true` and the reason. `none` continues with today's code.
- `retireIfLanded` and `reclaimFinishedHomes` pass `ticket.delivery` and `ticket.openspecChangeName`. The sweep's existing merged-PR-work-product shortcut stays; it is the weaker of the two proofs and already accepted by its spec.
- `retained.inspect` calls the same proof. `landed` sets `commitsNotOnLandingBranch = 0` and suppresses `branch_gone`, so a clean, proven copy returns `null` and VS-859 owns it. `unverified` adds the reason `landing_unverified` and the class `landing_unverified`, which takes precedence over `branch_gone`/`finished_unlanded` for a `done` ticket with a recorded merge. `unlanded(n)` keeps `finished_unlanded` with n as the count.

### D4. Removing a proven copy whose branch is gone

`reclaimFinishedHomes` currently removes through the provider by branch name, and worktrunk's `wt remove <branch>` cannot find a branch that no longer exists. When the recorded branch is not in the clone, the sweep removes by path instead: `git worktree remove <path>` then `git worktree prune`, the same fallback `retained.removeCopy` uses. It keeps `force: false`, so the copy must be clean, as it already must be for the sweep.

### D5. Measurement for the acceptance report

The corrected proof needs `tickets.delivery`. For agent-conductor tickets the worker reads it with `weave_ticket_get`. FanStack tickets are outside this worker's read scope, so their figure comes from the same content check run against the `edge` squash commit that names the ticket, and is labelled a proxy in the PR. Sizes come from `du -sk` per copy. The exact workspace-wide figure is what `weave worker retained` prints after the upgrade, and the PR says so. No live daemon database is opened.

## Risks / Trade-offs

- [Trusting `delivery` over git] → `delivery.merged` is written only by `mergeDone` after its own landing verification, and the head and content checks still bind the copy to it. A hand-edited delivery is outside the threat model: anyone who can edit it can also delete the directory.
- [Excluding `openspec/` paths from the content check] → A commit after the merge that touched only the ticket's own change directory would pass. It holds planning text that the archive already captured, and the branch is still kept in the clone except for branch-gone copies.
- [Branch-gone copies lose their only ref on removal] → Their content is proven present in the merge commit, so nothing that landed is lost. Unproven branch-gone copies stay on the approval path.
- [More automatic reclaims than before] → Only proven-landed, clean copies past `workerArchiveDays`, the same rule as VS-859, now applied to evidence that exists. The first retention pass after the upgrade will remove most of the backlog, and the PR states the expected count.

## Migration Plan

No schema change. Deploy, then the next retention pass and scan apply the new proof. Rollback is the previous release, and nothing removed by a pass is restored by rolling back, as with VS-859 today.
