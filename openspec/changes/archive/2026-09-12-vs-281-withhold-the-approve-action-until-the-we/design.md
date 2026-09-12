## Context

See `proposal.md` — Why, and the spec delta for the contract. This section records only the current-state facts the approach depends on, read from the code rather than assumed.

- The VS-266 hold is one computed predicate in `answer()` (`packages/core/src/decisions/service.ts:415`): `d.weaverReviewStatus === 'concerns' && ans.key === approvingKeyOf(d.kind)`. There is no "held" column; `weaver_review_status` defaults to `'unseen'` (migration `0027_agent_kind_weaver.sql:49`), and `weaverReviewCopy` already reads `?? 'unseen'`.
- The override is already a distinct pair on the answer shape — `overrideHold` + non-empty `overrideReason` — validated in the same predicate, recorded via `recordActivity(..., 'decision.hold_overridden', ...)` and surfaced with a ticket comment (`service.ts:450-459`). It is actor-agnostic and worker-liveness-agnostic.
- The weaver is woken about a new human-owned approval through the supervisor digest, not `create()`: `create()` only wakes when `owner === 'weaver'` (`service.ts:190`), but `decision.created` is a digest event and `supervisor/index.ts:510` includes a human-owned one raised in a worker run. So a card is reviewable without new wake code; the latency is the digest, which is exactly why the override must exist.
- `autoApprove()` (`packages/core/src/tickets/service.ts:282`) answers as `{ kind: 'system', id: null }` and is called for a YOLO plan approval at `to === 'proposed'` (`service.ts:590`) and for a YOLO merge approval in `autoMergeSweep` (`service.ts:1188`). Both use `key: 'approve'`.
- The YOLO plan approval is created and answered in the same transition, so its review state is always `unseen` at answer time. The YOLO merge approval lives across the CI window, so it can be marked `concerns` before the sweep answers it — that is the case VS-266's "An unattended merge held by a concern" scenario covers.
- `weaverReviewCopy` (`packages/shared/src/weaver-review.ts`) is the single copy table for the web card and `decisionToCard`; `held` already means "concerns + open", and `decisionToCard` threads it to the CLI card model (`packages/render/src/decision.ts:113`).

## Goals / Non-Goals

**Goals:**
- An approving answer on an `open`, **unseen** review-carrying decision is refused server-side with the same identifiable `revision_pending` outcome the concern-hold uses, naming the pending review.
- YOLO keeps working: the `system` actor is not held by the unseen state.
- The deadlock is closed: the human override reaches an unseen card without the weaver, the worker, or any daemon activity.
- The card still appears and says why the approve action is withheld.

**Non-Goals:**
- No new review state, no schema change, no new decision kind.
- No change to when the weaver is woken or what it reviews (VS-275 already covers answering a held review).
- No change to hire/discard/retry approvals or worker-raised questions — only the three review-carrying kinds.
- No second override mechanism; the VS-266 pair is reused.
- No fix for the pre-existing gap that a web merge-approval card offers no explicit "Request changes" button (see Decision 4) — this change withholds the approve action, it does not redesign the merge card's actions.

## Decisions

### 1. Extend the one predicate; reuse `revision_pending`

`held` becomes:

```ts
const approving = ans.key != null && ans.key === approvingKeyOf(d.kind);
const unseen = (d.weaverReviewStatus ?? 'unseen') === 'unseen';
const hasConcerns = d.weaverReviewStatus === 'concerns';
// VS-266 concern hold: every actor. VS-281 unseen hold: not the system actor.
const held = approving && (hasConcerns || (unseen && actor.kind !== 'system'));
```

The refusal stays `OcError('revision_pending', ...)` with details `{ weaverReviewStatus, weaverReviewNote?, weaverReviewedAt? }`, and the message names what is pending — "the weaver has not reviewed it yet" for `unseen`, the concern for `concerns`. **Alternative considered:** a new `review_pending` code. Rejected because the ticket asks for "the same distinct, identifiable outcome the concerns hold produces", one code keeps every existing caller (`decisionStaleness.ts`, the CLI, the UI error path) working without a second branch, and `details.weaverReviewStatus` plus the message distinguish the two cases. The UI does not depend on the code to render the hold at all — it derives it from the decision.

### 2. The unseen hold does not apply to the `system` actor; the concerns hold still does

This is the acceptance criterion 7 question, answered from reading the VS-266 clause. VS-266 deliberately held the system actor: an unattended auto-merge over a *stated* concern is the exact failure it exists to prevent, so it holds everyone. That reasoning does not transfer to `unseen`: on a YOLO ticket the plan approval is answered in the same breath it is created, so it is *always* unseen, and holding the system actor there makes YOLO incapable of granting the plan approvals it exists to grant — it would break the pre-existing "YOLO does not wait on a review" requirement for every plan, not just a flagged one.

The consistent principle is which actor can be harmed by the missing signal, not "hold everyone always": a stated concern holds every actor; the mere absence of a review holds only the human decision surface. So the `system` actor is exempt from the **unseen** hold and remains subject to the **concerns** hold exactly as written. `autoApprove()` is unchanged — it needs no override, because for the cases it can hit, no hold applies (YOLO plan is unseen; YOLO merge is only held if the weaver actually marked concerns, which the sweep already tolerates).

### 3. The override requires a stated reason for the unseen hold too

Considered: let an unreviewed override through without a reason, on the argument that skipping an unstarted review is less serious than overruling a stated objection. Rejected: the concern-override path already carries a reason, the reason is what makes the override visible on the ticket (acceptance criterion 6), and two override shapes for one predicate is a second, less-tested branch for no user-visible benefit. One consistent path is simpler to trust. The cost — one sentence — is trivial; the record is worth it. The override is therefore the unchanged `overrideHold` + `overrideReason` pair, and its ticket comment names which hold was overridden.

### 4. One shared `awaitsReview` flag beside `held`; the approve action is withheld, not disabled

`weaverReviewCopy` gains `awaitsReview: boolean`, true exactly when the review state is `unseen` and the decision is `open` — the same read the service uses. `held` keeps its VS-266 meaning (`concerns` + `open`); they are distinct axes because the copy differs ("waiting on the weaver's review" vs "waiting for a revision") and because conflating them would change the concerns card's existing copy. `decisionToCard` threads both flags to the CLI, and `resolveOverrideHold` accepts either.

In `DecisionCard.tsx`: for `awaitsReview`, render the review line's waiting sentence and **omit** the normal approve button, replacing it with the existing "Override & approve…" control (which opens the reason composer). Revise/reject stay for plan/action. This satisfies "the approve action is not offered" rather than merely disabling it, which is the point captain made.

The merge card's actions are left exactly as they are. It currently offers only "Approve merge" (plus, when held, the override and an "Ask the worker" link); there is no explicit "Request changes" button in the web card. Adding one is a separate UX change to a card VS-266 also left alone, and is out of scope here; the spec's "non-approving actions remain available" is read as "nothing existing is removed", with the merge card's non-approving answer still reachable through the API/CLI (`changes`). This is named here so the gap is a known, deliberate boundary rather than an oversight.

### 5. The unseen hold lifts on a review mark, not on supersession

The concerns hold lifts by supersession because a fresh card is the natural next question after a revision. The unseen hold does not: a fresh card is *also* unseen, so supersession would just move the hold. It lifts the moment the weaver marks the decision `looked` (or replaces it with a `looked at, with concerns` mark, which is its own hold). No new machinery: `review()` already writes the mark, and the predicate is a pure read of it. This is stated as its own scenario so the two lifts are not conflated.

### 6. Card copy comes from the shared table, so web and CLI cannot drift

The waiting sentence is added in `weaverReviewCopy`'s consumers through the existing copy fields, not hand-written per surface (the VS-114 landmine). `ConductorReviewLine` and `decisionToCard`'s `body()` each render the new sentence off `awaitsReview`; neither invents its own wording. The `revision_pending` copy in `decisionStaleness.ts` branches on `details.weaverReviewStatus` so a refused unseen answer reads as "the weaver hasn't reviewed this yet" rather than "the weaver has concerns".

## Risks / Trade-offs

- **[Risk] A large test sweep.** Every existing test that raises a review-carrying decision and answers `approve` while it is unseen now fails — `decisions.test.ts`, `integration.test.ts`, the ticket/YOLO suites and the UI tests. → **Mitigation**: an explicit task to audit and update them; the correct fix is normally to mark the card **looked** first, which is also the new production path, and only tests specifically about the approving action use the override.
- **[Risk] A weaver that never marks `looked` strands the human.** → **Mitigation**: the override (Decision 3), available with no dependency on the weaver's or worker's state; tested with the weaver paused/failed/never-run per acceptance criterion 5.
- **[Risk] Widening the hold changes YOLO for every plan.** → **Mitigation**: the system-actor exemption (Decision 2); the existing YOLO plan and merge tests must stay green and an explicit test asserts the system actor is not held by an unseen card.
- **[Risk] Reusing `revision_pending` hides which hold fired from a caller that catches only the code.** → **Mitigation**: `details.weaverReviewStatus` is always present and the message names the pending review; the UI derives the card state locally and the CLI reads `awaitsReview`/`held` off the card, so neither depends on the code alone.
- **[Risk] The merge card offers no non-approving button, so an unreviewed merge card shows only the override.** → **Mitigation**: named as a deliberate boundary in Decision 4; the non-approving answer remains available via API/CLI. A follow-up can surface it in the web card if wanted.
- **[Risk] Tests that approve `secondPlan`/`secondMerge` after a revision cycle assume the fresh card approves freely.** → **Mitigation**: those tests (the VS-266 lift scenarios) are updated to mark the fresh decision **looked** first, which still proves the *prior concern* no longer holds it.

## Migration Plan

No data migration: no column is added or changed. Ship as one change, server-side gate first (it is safe to land alone only with the override in the same change, which is why they are one ticket). No feature flag. Rollback is a code revert; the stored review states remain valid either way.

## Open Questions

None that change the specs, approach, or task breakdown.
