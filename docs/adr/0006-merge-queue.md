# ADR 0006 — Approved merges land through a per-project queue, one at a time

Date: 2026-09-05 · Status: accepted

## Context
PLAN §11.5 says "Concurrency: many workers per project, each in its own worktree; conflicts surface at merge time and are resolved by the merging worker (§11.4). **Serialize only on declared blockers.**" Taken literally, an approved merge starts immediately, and that is what the code did: `applyMergeApproval` transitioned to `merging` and `transition()` woke the worker on the spot.

With more than one approval outstanding it does not hold. `landDelivery` runs `git checkout`, `git merge --ff-only` and `git fetch` in `project.clonePath` — the one clone every ticket of the project shares — and had no lock, so two `weave_ticket_merge_done` calls at once leave the clone on the wrong branch or fail each other's fast-forward, and the loser reports `merge_unverified` for work it really did merge. The `openspec archive` step immediately after it had been serialized per project since it was written; the landing step had not. A ticket approved while another was merging also had no way to learn that its base had moved, so it discovered it as a conflict mid-merge.

## Decision
Serialize the landing step per project, against §11.5's sentence, and record the queue as first-class state:

- Entering `merging` joins a per-project queue (`tickets.merge_queued_at`) instead of waking the worker. The queue admits tickets in join order (`tickets.merge_started_at`) while fewer than `mergeConcurrency` are in the active merge step, and admission is what wakes the worker. `mergeConcurrency` is a project policy, an integer ≥ 1, default 1.
- Leaving `merging` for any status clears both stamps and admits the next ticket, so a merge that fails and blocks does not hold the queue.
- The supervisor pumps every project's queue on its tick, so a queue whose head vanished with a daemon restart advances on its own.
- A waiting ticket does not cause a worker spawn and is not a liveness violation: the queue is its action path. A worker is brought back when the ticket is admitted. Workers already alive from the build phase are left alone — retiring them would discard the session that knows the change.
- `mergeDone` wraps `landDelivery` in the same per-project serializer the archive uses (now `packages/core/src/util/serialize.ts`), because `mergeConcurrency` can be raised above 1 and reconciliation can call `mergeDone` outside the queue.

The plan's §11.4 and §12.2 step 6 are updated to describe the queue; §11.5's "serialize only on declared blockers" now reads as being about the *building* phase, which is unchanged: ten workers still build in parallel.

## Consequences
- N approved tickets take N merge turns in sequence rather than in parallel. That is the intent: the parallel version corrupted the shared clone and cost more turns in failed verifications than the wait costs.
- A worker that holds the active slot and neither merges nor fails stalls everything behind it. There is deliberately no timeout: the existing stuck-worker ladder (§11.6) ends in `blocked`, which releases the slot, and the queue is visible in the web app, the CLI and the ticket payload so a human can see a head that is not moving.
- Ordering is first-in-first-out, not by priority. Priority already decides what gets built; re-ordering the landing step would let a high-priority ticket jump a branch that has already rebased onto the current default branch.
- Two new nullable columns on `tickets`, and no down-migration: an older daemon ignores them and merges immediately on approval again, which is the previous behavior.
