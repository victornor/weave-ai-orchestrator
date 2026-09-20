## Context

See proposal.md — Why. The relevant current state:

- `packages/core/src/promotion/index.ts` raises a `promotion_approval` whose `context`
  and `target.promotion` are a snapshot at raise time. `status(projectId)` computes the
  live heads, the tree diff (`changedFiles`), the resulting commit/ticket lists, and
  `ahead`/`behind`.
- `execute()` refuses when `d.weaverReviewedHeadSha` does not match the live landing
  head, throwing `revision_pending` with `{ weaverReviewedHeadSha, landingHead }`.
- `weaverReviewedHeadSha` is recorded for a `promotion_approval` by the
  `weave_decision_review` tool through `promotion.currentHead(d)` (the live landing
  head).
- `decisions.create` already wakes the weaver when a review-carrying card is raised
  (`carriesWeaverReview`, which includes `promotion_approval`), keyed per decision.
- The supervisor already sweeps promotions every `MERGE_POLL_EVERY_MS`:
  `await deps().promotion.advance()` (supervisor/index.ts, the `supervisor:merge_ci_at`
  due-block).
- `waitingTickets` skips a ticket stamped `promotedAt` (VS-584) but otherwise uses
  `merge-base --is-ancestor <landedSha> <defaultRef>`, which a squash promotion
  defeats; `ahead` is `rev-list --count default..landing`, which counts every commit
  edge ever carried.

## Goals / Non-Goals

**Goals:**
- An open card always describes the current landing content and the current heads.
- The weaver is re-asked to review at the new head without human action; a stale
  review is visible and self-clearing.
- Tickets and `ahead` are content-based, so a squash promotion cannot re-list shipped
  work or inflate pending commits.
- No new polling loop; no schema migration; the human-only promotion guard unchanged.

**Non-Goals:**
- Changing how a promotion is performed (pull request vs direct push, merge method,
  check waiting) — VS-584 behavior is untouched.
- Auto-answering, auto-withdrawing or auto-promoting a card. A card whose content is
  all shipped keeps existing, refreshed to show nothing waiting, with the Promote
  option withdrawn; a human dismisses it.
- Making `weaverReviewedHeadSha` mean something new for other card kinds.

## Decisions

### Refresh in place, do not supersede

The card is recomputed on the same decision row: `context`, `optionsJson` and
`targetJson.promotion` are rewritten; the decision id, `correlationKey` and any
existing review mark are preserved. `targetJson.promotion.reviewStale` is set from the
live comparison.

Alternatives considered:
- *Supersede with the same correlation key* (the existing replace-an-open-card path).
  Rejected: superseding closes the old card, so the human's refusal becomes
  `wrong_status: superseded` rather than `revision_pending`, and the required "edge
  moved since the last review" statement has no card to live on. It would also churn a
  new card on every landing.
- *Leave the card and only fix the copy.* Rejected: the card would still show the old
  commits, tickets and file counts — the reported bug.

### Refresh from the supervisor's existing promotion cadence

`promotion.refresh()` is awaited in the same due-block that already runs
`promotion.advance()`. It queries open `promotion_approval` decisions, computes the
live `status()` for each card's project, and refreshes any card whose recorded target
head differs from the live landing head.

Alternatives considered:
- *Hook the ticket-landing path (tickets/service.ts, where `landedOn`/`landedSha` are
  stamped).* More immediate, but it is a second call site, does not cover a landing
  that arrives by a manual push, and couples the tickets service to promotion.
- *A new dedicated timer.* Rule and instruction: no new polling loop; the supervisor
  tick is the existing trigger.

The supervisor cadence runs at `MERGE_POLL_EVERY_MS`; a card can lag the head by up to
one tick, which the refusal path still guards correctly because `execute()` computes
the live head independently.

### Staleness is a persisted flag, cleared by the next refresh

On refresh, `reviewStale = weaverReviewedHeadSha != null && !sameGitSha(weaverReviewedHeadSha, liveLandingHead)`.
The mark itself is left as-is (a `concerns` mark must keep holding, and a `looked` mark
records what was true when it was made). Because every refresh recomputes the flag from
`weaverReviewedHeadSha` and the live head, the flag clears the next time the weaver
marks the card at the new head — no cross-service hook in `decisions.review`.

Alternative considered: reset `weaverReviewStatus` to `unseen` on refresh. Rejected:
it discards the fact that a review happened and the "moved since the last review"
statement has nothing to compare; it also drops the card out of the human's count
before the weaver has actually re-reviewed.

### The card and the refusal share one line

`weaverReviewCopy` stays the review copy table. A small pure helper describes the
promotion card's held state (`stale`, `line`, the two heads) from the decision's
`target.promotion` and `weaverReviewedHeadSha`; the V2 card renders it, and
`staleAnswerCopy` maps the `revision_pending` head-mismatch details to the same line.
`execute()` adds `weaverReviewHeadMismatch: true` to its `revision_pending` details so
the UI can tell a moved head from a concerns hold without guessing.

### Content-based ticket and commit filtering

Add a helper `contentAlreadyOnDefault(clone, defaultRef, landingRef, sha)`:
1. `merge-base --is-ancestor <sha> <defaultRef>` → shipped.
2. Otherwise take the commit's changed paths (`git diff-tree --no-commit-id --name-only
   -r -m --first-parent <sha>`) and run `git diff --quiet <defaultRef> <landingRef> --
   <paths>`; exit 0 (no difference) → the content is on the default branch → shipped.
3. No paths (an empty commit) → not pending content.

`waitingTickets` skips candidates for which it returns true (keeping the VS-584
`promotedAt` stamp skip). The commit list and `ahead` are computed by the same test:
`commits` keeps only commits whose content is missing, and `ahead` is that list's
length. The whole computation is gated on `content.changedFiles > 0` and bounded by
`RANGE_LIMIT`, so a project with nothing to promote pays nothing. Git calls are
batched per commit rather than per file.

Alternative considered: `git cherry` patch-id equivalence. Rejected: a squash combines
several commits into one whose patch-id matches none of them, so it reports them as
still pending — the exact failure being fixed.

`changedFiles`/`additions`/`deletions` remain the aggregate tree diff and the source of
truth for "there is something to promote".

## Risks / Trade-offs

- [The refresh runs `status()` (a `git fetch`) per open card per tick] → at most one
  card per project, and `advance()` already fetches on the same cadence; the added
  cost is one fetch per project with an open card.
- [Per-commit content checks are O(commits) git calls] → bounded by `RANGE_LIMIT` and
  skipped entirely when `changedFiles` is 0; batched per commit.
- [A card can lag the live head by up to one supervisor tick] → the refusal path is
  independent of the refresh and computes the live head, so a stale card can never be
  approved at an unreviewed head; only the displayed statement is briefly behind.
- [A card whose content is entirely shipped now offers only Dismiss] → intended; it is
  the honest "nothing waiting" state, and the human dismisses it rather than seeing a
  Promote that would fail.

## Migration Plan

No schema change: the refresh writes the existing `decisions.context`, `options_json`
and `target_json`; `reviewStale` rides inside `target_json.promotion`. Rollback is a
plain revert; no data backfill is needed because the flag is recomputed on the next
tick and a missing flag reads as not stale.

## Open Questions

None.