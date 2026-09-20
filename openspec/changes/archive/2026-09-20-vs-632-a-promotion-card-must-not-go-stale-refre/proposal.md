## Why

A promotion card is a frozen snapshot taken when it is raised, so the moment anything
lands on the landing branch the card still shows the old commits, the old tickets and
the old file count — and the weaver's review mark is now against a head that no longer
exists. `promotion.execute()` then refuses every Approve with `revision_pending`, but
nothing wakes the weaver to re-review and the card exposes no reason: `Promote edge to
main for fernwood` sat unapprovable for 20 hours on 2026-09-19/20 while six tickets
landed on `edge`. The status surface compounds it: after a squash promotion, ancestry
still counts shipped commits, so a card can promise 64 pending commits and re-list
tickets that are already in production.

## What Changes

- **The card tracks the landing branch.** While a `promotion_approval` is open, the
  daemon recomputes it in place whenever the landing head moves — its context, its
  target record (heads, tickets, changed-file summary, ahead/behind, notes, held
  reason) and its offered options — driven from an existing trigger (the supervisor
  tick that already runs `promotion.advance()`, or the landing merge), with no new
  polling loop.
- **The weaver is re-asked to review.** The same refresh enqueues one wake to the
  weaver naming the card and the new head, so a fresh `looked` mark lands at the new
  head without the human doing anything. A `concerns` mark keeps holding the card.
- **Approve says why it is refused.** A `revision_pending` refusal on a promotion
  whose reviewed head is stale reaches the card as a visible line ("edge moved since
  the last review; the weaver is re-checking it"), and clears itself once a review
  lands at the current head.
- **Squash-aware, honest lists.** The tickets listed on the card and in
  `GET /projects/:id/promotion` are only those whose landed content is not already on
  the default branch, and `ahead` counts only commits whose content is missing from
  the default branch — not the commit count a squash promotion leaves behind. The
  `changedFiles` tree-diff measure stays the source of truth for "something to
  promote".
- The `forbidden` guard in `execute()` is untouched: nothing but a human can promote.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `ticket-delivery/promotion`: an open promotion card tracks the current landing head
  and is refreshed from an existing trigger; the weaver is re-woken to review the new
  head; a stale-review refusal is visible on the card; tickets and `ahead` are
  content-based and squash-aware.

## Impact

- `packages/core`: `promotion/index.ts` gains a refresh sweep (recompute + persist an
  open card, wake the weaver) and content-based ticket/commit/ahead computation;
  `supervisor/index.ts` calls the sweep from the existing promotion cadence;
  `decisions/service.ts` (or the promotion service) makes the stale-review refusal
  carry the head-mismatch detail the card reads.
- `packages/shared`: a small pure helper describing a promotion card's review-stale
  state, for the card and the refusal copy; `weaver-review.ts` stays the review copy
  table.
- `packages/ui`: the V2 Needs-you card renders the held promotion state and the
  reason, and `decisionStaleness.ts` turns the refusal into the human's terms.
- No DB migration: the refresh rides the existing decision `target_json`, `context`
  and `optionsJson`; no new columns.
- Tests: `packages/core/src/promotion/promotion.test.ts` (refresh+re-review,
  squash-aware lists and `ahead`), `packages/shared` (the stale helper), and
  `packages/ui` (Needs-you render check in both themes).