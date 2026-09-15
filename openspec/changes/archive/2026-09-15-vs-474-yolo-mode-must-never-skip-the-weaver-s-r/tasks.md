# Tasks

## 1. Hold the daemon's own grant until the card is reviewed

- [x] 1.1 In `packages/core/src/decisions/service.ts`, remove the `system`-actor exemption from the
  unseen hold: `held = approving && (hasConcerns || unreviewed)`. Confirm from `approvingKeyOf` that
  `approving` is only ever true for a review-carrying kind, so non-review kinds and `action_approval`
  are unaffected. Update the VS-266/VS-281 comment to state that YOLO now waits for the review.

## 2. Stop answering at raise time

- [x] 2.1 In `packages/core/src/tickets/service.ts`, remove the eager `autoApprove` grant at the
  `proposed` transition and the `autoApproved` flag/re-read it forces, so a YOLO plan approval is left
  open and unseen.
- [x] 2.2 Remove the eager `autoApprove` grant in `repairApprovals()`'s plan branch (the card stays
  open and unseen).
- [x] 2.3 Remove the eager `autoApprove` grant in `republishRevisedPlan()` (the fresh card stays open
  and unseen).
- [x] 2.4 Remove the eager `autoApprove` grant in `raiseArchiveBackfillCard()` (the card stays open and
  unseen).
- [x] 2.5 Leave `autoMergeSweep()`'s `autoApprove` call in place: it is now held by the review state
  and remains the single CI-readiness gateway.

## 3. Grant as soon as the review lands

- [x] 3.1 Add `onReviewLooked(decisionId): Promise<void>` to the tickets service: no-op unless the
  decision is open, `looked`, and on a YOLO project; grant a `plan_approval` immediately; grant an
  archive-backfill `merge_approval` (one carrying an `archive` target) immediately; do nothing for an
  ordinary `merge_approval` (the sweep grants it).
- [x] 3.2 Make `decisions.review()` async and, after a `looked` mark has been written, await
  `deps().tickets.onReviewLooked(d.id)`. A grant failure must not fail the review write (log it).
- [x] 3.3 Add both methods to the `TicketsService` / `DecisionsService` interfaces in
  `packages/core/src/api.ts` and update call sites (`packages/server/src/tools.ts`) and tests for the
  async return.
- [x] 3.4 Add `tickets.approvalDeliveryHead(decision): Promise<string | null>`: the archive pull
  request's head when the card carries an `archive` target, otherwise `deliveryHead(decision.ticketId)`.
  Use it in `packages/server/src/tools.ts`'s `weave_decision_review` handler to record
  `weaverReviewedHeadSha`, so an archive card records the archive PR's head, not the ticket's old PR.
- [x] 3.5 Enforce the head match in `decisions.answer()`'s hold, scoped to `actor.kind === 'system'`
  and `kind === 'merge_approval'`: a `looked` card whose `weaverReviewedHeadSha` is null or does not
  git-sha-equal the current `approvalDeliveryHead` is held (`revision_pending`) with a distinct
  `details` marker naming the mismatch. Human answers are untouched.
- [x] 3.6 In `onReviewLooked`, when an archive-backfill card is held by the head match (no grant),
  record the head-mismatch waiting comment once so the ticket shows why (archive cards have no sweep).

## 4. The sweep says why it is waiting

- [x] 4.1 In `autoMergeSweep()`'s `revision_pending` catch, read
  `error.details.weaverReviewStatus` / the head-mismatch marker and record "auto-merge is waiting: the
  weaver has not reviewed it yet" for `unseen`, "auto-merge is waiting: the weaver has not reviewed the
  current head yet" for a head mismatch (through VS-472's `recordAutoMergeHold`, keyed by head so it
  posts once per head), and keep "auto-merge is waiting: the weaver has concerns" for `concerns`.

## 5. Prompts

- [x] 5.1 Update the weaver and worker YOLO paragraphs in
  `packages/core/src/prompts/defaults.ts` to say the daemon grants the approval *after the weaver's
  review* (plan once validated and reviewed; merge once reviewed and the checks are green).
- [x] 5.2 Update the same paragraphs in `templates/weaver.AGENTS.md.tmpl` and
  `templates/brief.md.tmpl`, which override the built-in defaults.

## 6. Docs

- [x] 6.1 Update `docs/PLAN.md` §15: the YOLO paragraph says the daemon grants plan and merge
  approvals after the weaver's review; the review sentence no longer says a YOLO auto-approve leaves
  the row `unseen` (it now waits for `looked`).

## 7. Tests

- [x] 7.1 Core (`packages/core/src/decisions/decisions.test.ts`): under YOLO a raised plan approval
  stays open while unseen; a `looked` mark grants it once as the `system` actor; a `concerns` mark
  keeps it open and a fresh revision plus `looked` grants it; a merge approval stays open through
  sweeps while unseen and, after `looked` plus green CI, the sweep grants it.
- [x] 7.2 Core: archive-backfill under YOLO is held while unseen and granted on the `looked` mark.
- [x] 7.3 Core: a human's own approval and the deliberate override behave as before.
- [x] 7.4 Core: an `auto_merge` ticket with no decision is unchanged.
- [x] 7.5 Update the VS-281 test that relied on the system exemption to assert the new behavior, with
  a comment giving the reason (YOLO no longer bypasses the review).
- [x] 7.6 Update `packages/core/src/prompts/render.test.ts` for the new YOLO wording, both the
  built-in defaults and the shipped templates.
- [x] 7.7 Add an integration test reproducing 2026-09-15: a YOLO project; a merge card raised and
  never reviewed stays unlanded across 5 sweeps; after `looked` and green CI the sweep lands it.
- [x] 7.8 Head match: a YOLO merge card is marked `looked` at head A, the worker pushes head B, and
  sweeps do not grant (recording the "current head" wait once); after `looked` at B the sweep grants.
- [x] 7.9 Head match for archives: an archive-backfill merge is held when its pull request head moved
  after the mark, and grants after a fresh `looked` mark at the new head; a `looked` mark on a normal
  merge is unaffected when the head is unchanged.

## 8. Verify

- [x] 8.1 `pnpm lint && pnpm typecheck` green.
- [x] 8.2 `pnpm test` green, pasting both suite blocks verbatim (core/server and UI).
- [x] 8.3 `grep autoApprove` and list every caller in the delivery, confirming each is covered.
