## Context

See proposal.md — Why. The relevant current machinery:

- `packages/core/src/openspec/index.ts` `archiveAfterMerge` is the post-merge backfill. For a
  `pr`-delivery project it commits the archive on a fresh `ac/archive-<change>` branch off the
  landing tip, pushes it, opens a pull request through the forge's optional `createPullRequest`, and
  records only an `openspec.archive_pr_opened` activity plus a `ticket.updated` event carrying
  `openspecArchivePendingPrUrl`. Nothing persists that URL and nothing consumes the event.
- `mergeDone` (`packages/core/src/tickets/service.ts`) calls `archiveAfterMerge` only when its own
  in-merge archive sequence did not run (`archivedByNewFlow === false`), and it discards the returned
  `pendingPrUrl`, keeping only `archivedAs`/`skipped`.
- The supervisor's `reconcileOpenSpecArchives` (`packages/core/src/supervisor/index.ts`) is the only
  caller that converges left-behind changes: for every `done` ticket whose change directory still
  exists in the primary clone and is not in `changes/archive/`, it calls `archiveAfterMerge`.
- `decisions.create` (`packages/core/src/decisions/service.ts`) drops the ticket attachment when the
  named ticket is already terminal (VS-306), and `applyMergeApproval` no-ops on a detached decision
  and otherwise transitions the ticket to `merging`. The stale-terminal sweep
  (`sweepTerminalTickets`) withdraws open decisions attached to terminal tickets.
- `attemptArchiveThenMerge` (`packages/core/src/tickets/archive-before-merge.ts`) is ticket-agnostic:
  given `{ clonePath, branch, landingBranch, changeName, forge, prUrl, method }` it fetches the
  landing tip, puts a detached scratch worktree on `origin/<branch>`, rebases when stale, archives the
  change only when the change directory is still present, pushes, checks the forge's rolled-up CI, and
  merges. For an archive branch where the change is already under `changes/archive/`, it merges
  without touching the branch.
- `landLock` (serialized per project) is what `mergeDone` runs a landing under, and the supervisor's
  archive pass shares it.

### Diagnosis: why these three left the in-merge archive

Confirmed from `main`. The archive commits are direct children of the tickets' own merge commits and
live only on their `ac/archive-*` branches:

- VS-334 archive `33034d7d`'s parent is `6f51a600` (VS-334's merge on `main`), and `33034d7d` is on
  `origin/ac/archive-vs-334-…` only; `git merge-base --is-ancestor 33034d7d HEAD` is false.
- The same shape holds for VS-338 (`a4e4c8da`) and VS-339 (`f762600b`).

That is exactly what `scratchBranchFrom(project.clonePath, 'HEAD', 'ac/archive-<change>')` produces
right after a merge, so the post-merge `archiveAfterMerge` backfill ran; the in-merge
`attemptArchiveThenMerge` did not. `mergeDone` reaches `archiveAfterMerge` only when
`archivedByNewFlow === false`, which in the `pr` flow means the forge already reported the pull
request `merged` when `mergeDone` ran (the ticket was merged out of band / by the legacy
worker-merged contract on the release that landed it), or no PR work product was found. So the bug
is not that the archive PR mechanism is wrong — it is that its resulting PR is invisible. **The path
is still reachable on the current release** for any ticket whose PR merges outside `mergeDone`, which
is why the fix is a surfacing/landing one and not a "this can no longer happen" one. A task records
this finding on the ticket.

## Goals / Non-Goals

**Goals:**

- Every archive-backfill pull request is surfaced as an approvable merge card on its ticket, whether
  it is opened now or already open, and is landed through the daemon's normal review path.
- The three existing strays surface on the first reconciliation pass after the change ships.
- A finished ticket's surfaces show whether its spec archive is still pending.

**Non-Goals:**

- Changing the in-merge archive flow (`attemptArchiveThenMerge`), which already archives a normally
  landed ticket's change before its merge.
- A literal new row in the ticket merge queue: that queue is keyed to a ticket in `merging` and wakes
  the ticket's worker (see Decisions 3).
- Backfilling #282, #313 or #314 by hand, or touching live GitHub. The sweep is what surfaces them.
- Adding the mark to the V1 ticket page; the ticket names the ticket detail view and the Work board
  card, both V2.

## Decisions

### 1. The card is a `merge_approval` whose `target` names the archive

`Decision.target` is free-form JSON (`DecisionCreateInput.target?: Record<string, unknown>`), so the
archive card sets `target: { archive: { changeName, branch, prUrl, number } }`. That single field is
what every other decision makes recognisable: `applyMergeApproval` branches on it to land the archive
instead of transitioning the ticket, `create`'s terminal carve-out keys on it, the stale-terminal
sweep exempts it, and the surfaces can link the pull request from it. `correlationKey` is
`merge_approval:archive:<ticketId>:<changeName>`, distinct from a ticket's own
`merge_approval:<ticketId>`, so neither supersedes the other.

Alternatives considered: a new decision kind (rejected — the ticket names `merge_approval`, and a new
kind touches every card renderer and the review/repair machinery); reusing the ticket's own merge
card (rejected — that card was answered at merge time and the ticket is done).

### 2. `create` keeps the attachment for an archive card on a terminal ticket

`decisions.create` currently nulls the attachment for a terminal ticket (VS-306). Add an explicit
input flag (e.g. `attachToTerminal?: true`) that `create` honours only for a `merge_approval` whose
target names an archive backfill; no other caller can attach a card to a terminal ticket. The
project is already resolved from the requested ticket and the correlation key already derives from
it, so both need no change. The card is then answerable on the ticket and, carrying weaver review, it
wakes the weaver at creation through the existing VS-361 path.

The same field is what lets the answer path find the ticket: `applyMergeApproval`'s `ticketOf(d)`
returns it instead of null.

Alternatives considered: keeping the card detached and re-finding the ticket from the archive target
(rejected — the ticket named it, so the card belongs on it; detachment would also put it in the
shared no-ticket bucket and risk superseding an unrelated card).

### 3. Approving lands the archive under the project landing lock, not the ticket queue

`applyMergeApproval` gains an `if (target.archive)` branch that calls a new tickets-service method
which, under `landLock(project.id)`, calls the existing `attemptArchiveThenMerge` with
`branch: 'ac/archive-<change>'`, the change name, the PR URL and the project's merge method. On the
archive branch the change is already under `changes/archive/`, so `attemptArchiveThenMerge` skips
re-archiving and merges directly — the exact behaviour a retry needs. A stale branch is rebased and
force-pushed to the sweep-owned archive branch; `checks_pending`/`checks_failed` do not merge.

`landLock` is the same per-project serialization `mergeDone` runs under, so an archive landing and a
ticket merge for one project never overlap; that is the merge queue's substantive guarantee. The
merge queue proper (`tickets/merge-queue.ts`) is not joined: it is keyed to a `merging` ticket with a
worker to spawn and wake, and the archive card's ticket is `done`. Building a synthetic queue entry
for a workerless landing is disproportionate and would widen the queue's contract. If a reviewer
wants the archive landing to be visible in the queue report itself, that is a plan revision, not a
silent change.

### 4. The reconciliation sweep is the convergence and retry engine

`reconcileOpenSpecArchives` already runs on the reconcile cadence and already has the archive-failure
record/comment/wake helper. Extend it to three cases, all idempotent:

1. **Ensure the PR and the card.** For a `done` ticket whose change is unarchived on the landing
   branch, call `archiveAfterMerge` (which now persists and returns the pending PR, and replaces a
   closed-unmerged one). If the returned PR has no open card and is not the one a `changes` answer
   declined, raise the card — and under YOLO, answer it immediately.
2. **Retry an approved landing.** For an archive card answered `approve` whose change is still
   unarchived, retry the landing; a standing failure is recorded once and wakes the weaver, reusing
   the existing helper.
3. **Clear the pending mark.** Once `archivedDirFor` finds the change archived, update the ticket's
   delivery to the landed/clear state.

A `changes` answer records the declined PR URL in the ticket's delivery, and the sweep does not
re-raise while the pending PR is that same URL — so a declined card is not re-raised every pass, and
a fresh backfill (new PR or moved head) gets a fresh card.

### 5. Visibility rides the existing free-form delivery JSON

No migration: `tickets.delivery_json` is untyped JSON and both writers that touch it spread what is
already there (`supervisor/index.ts` PR refresh, `mergeDone`). `archiveAfterMerge` writes
`openspecArchive: { changeName, pendingPrUrl, state: 'pending' }`; a landing writes
`state: 'landed'`, `archivedAs`. The V2 ticket detail and Work card read it and render a "spec archive
pending" mark with the PR link; `ticket.updated` already triggers the query invalidation that rereads
the row.

### 6. Closed-unmerged handling reuses `createPullRequest`

On the existing-branch path, when `pullRequestForBranch` (open only) returns null, look for a closed
PR on the branch via the optional `listPullRequests` (its `headRefName`/`state` fields are enough),
record `openspec.archive_pr_closed` on the ticket, then open a fresh PR from the pushed branch. A
forge without `listPullRequests` simply cannot distinguish "closed" from "never opened" and opens a
fresh PR anyway — which is never a silent reopen.

## Risks / Trade-offs

- **A card attached to a terminal ticket contradicts VS-306's general rule.** → The carve-out is
  explicit, gated on the archive target, and covered by tests asserting an ordinary terminal-ticket
  card is still detached and still swept.
- **The stale-terminal sweep could close the card.** → The exemption is part of the spec delta and
  tested; the card is otherwise never withdrawn until answered.
- **`changes` could be re-raised forever.** → The declined PR URL is recorded and suppresses
  re-raising until the PR changes.
- **`attemptArchiveThenMerge` returns `checks_pending` without waiting.** → The sweep is the retry,
  so a pending check delays the archive rather than losing the approval; this mirrors how a ticket's
  `merge_checks_pending` is retried by its worker.
- **Force-pushing the archive branch could clobber a hand-edit.** → `ac/archive-*` branches are
  daemon-owned and never human-edited; the same force-with-lease the ticket flow already uses guards
  against a lost concurrent update.
- **Rollback.** → A release without this change ignores `deliveryJson.openspecArchive` (harmless) but
  its `applyMergeApproval` would try to transition the finished ticket to `merging` and fail
  cleanly; the card would simply wait. No data is corrupted; the daemon returns to the previous
  release and the cards can be landed again after re-upgrading.

## Migration Plan

No schema migration. The change ships with a daemon upgrade/restart; the first reconciliation pass
after boot calls `archiveAfterMerge` for the three strays, persists their pending PRs, and raises
their cards. Rollback is the previous release (see Risks).

## Open Questions

None that change the specs, approach or task list. The one judgement worth a reviewer's eye — the
archive landing sharing the project landing lock rather than joining the ticket merge queue — is
Decision 3.
