## 1. Shared and render: the card signals the hold

- [x] 1.1 In `packages/shared/src/weaver-review.ts`, add `awaitsReview: boolean` to `WeaverReviewCopy` and the returned copy: true exactly when the review state is `unseen` and `status === 'open'`, false otherwise (including every non-open status and both other review states). Leave `held`'s VS-266 meaning unchanged. Verify with `weaver-review.test.ts`: `unseen`+`open` reports `awaitsReview: true`; `looked`, `concerns`, and an `unseen` decision that is answered/superseded/withdrawn/expired all report false.
- [x] 1.2 Thread the flag to the CLI/TUI card: add `awaitsReview` to `CardModel` (`packages/render/src/types.ts`), set it from `weaverReviewCopy` in `decisionToCard` (`packages/render/src/decision.ts`), and render the waiting-on-review sentence in `body()` when true — in addition to the existing review line, never replacing it. Verify with a `packages/render` card test.

## 2. Core: the unseen hold, its lift, and the override

- [x] 2.1 In `packages/core/src/decisions/service.ts`'s `answer()`, extend the VS-266 predicate so an approving answer on a still-`open` decision is held when the review state is `unseen` as well as `concerns`, exempting the `system` actor for the `unseen` case only. Throw the same `OcError('revision_pending', ...)` with details carrying `weaverReviewStatus` and, for a concern, `weaverReviewNote`/`weaverReviewedAt`; the message names what is pending. Verify with a unit test per kind: open `plan_approval`, `merge_approval` and `action_approval` each refused with `revision_pending`, `weaverReviewStatus: 'unseen'`, the decision still `open`, and the ticket not advanced.
- [x] 2.2 Verify the concerns case is unchanged: a `concerns`-marked open decision still refuses its approving answer with the concern-naming `revision_pending`, and a `looked` decision still approves freely with no override. Verify with the existing VS-266 tests plus an explicit `looked` case.
- [x] 2.3 Verify the `system` actor is not held by `unseen`: answering `approve` as `{ kind: 'system' }` on an unseen plan and an unseen merge succeeds. Verify with a core/`yolo.test.ts` test, and confirm the YOLO plan and YOLO merge auto-approval tests stay green.
- [x] 2.4 Verify a non-approving answer is never refused on account of review state: `revise`/`reject` on plan and action, and the non-approving option on merge, each succeed for the `unseen`, `looked` and `concerns` states. Verify with tests covering all three states.
- [x] 2.5 Verify the override on an unseen card: answering the approving key with `overrideHold: true` and a non-empty `overrideReason` succeeds, records a `decision.hold_overridden` activity entry carrying which hold and the reason, and posts a ticket comment naming the pending weaver review. Verify that the same answer without `overrideHold`, or with a blank reason, is still refused with `revision_pending`.
- [x] 2.6 Verify the override has no effect on an unheld decision: supplying it on a `looked` decision (and on an already-`open` decision that is not held) answers normally and records no override. Verify with a test.
- [x] 2.7 Verify the unreviewed hold lifts when the weaver marks the decision `looked`: an unseen open decision that is then marked `looked` approves without an override, and the card no longer reports `awaitsReview`. Verify with a test.
- [x] 2.8 Verify the override does not depend on the weaver or worker: with the weaver agent paused/failed/absent and the worker retired, the human can still override an unseen card and approve. Verify with a test that never marks the decision and never uses a worker.

## 3. API and CLI surface

- [x] 3.1 Confirm the answer body schema and pass-through in `packages/server/src/routes/decisions.ts` carry `overrideHold`/`overrideReason` unchanged, and that the refusal maps to HTTP 409. Verify with a route test: `POST /decisions/:id/answer` with `approve` on an unseen decision returns 409 `revision_pending` with `details.weaverReviewStatus === 'unseen'`; with the override pair it succeeds.
- [x] 3.2 In `packages/cli/src/commands/decision.ts`, make `resolveOverrideHold` accept a card that is `held` **or** `awaitsReview`, and update its "does not apply here" message to name both holds. Verify with a CLI-layer test (or the existing decision-command test) that `--override-hold` is accepted on an unreviewed card and still rejected on a plain `looked` one.

## 4. Web UI

- [x] 4.1 In `packages/ui/src/lib/decisionStaleness.ts`, branch the `revision_pending` copy on `details.weaverReviewStatus` so an unseen refusal reads as "the weaver hasn't reviewed this yet — it can be overridden with a reason", distinct from the concern copy. Verify with a `decisionStaleness.test.ts` case per state.
- [x] 4.2 In `packages/ui/src/components/DecisionCard.tsx`, when `weaverReviewCopy(decision).awaitsReview` is true: do not render the normal approve button (plan/action `Approve` or merge `Approve merge`), render the existing "Override & approve…" control and its reason composer instead, keep the non-approving actions available, and show the waiting-on-review sentence. Verify with a component test asserting the approve button is absent, the override control is present, and the sentence renders.
- [x] 4.3 Verify the existing VS-266 held rendering and every inert/answered path is unchanged, and that no bare role/button query in the DecisionCard tests is broken by the new control. Verify the affected UI tests are green, scoping queries with `within(...)` if needed.

## 5. Existing-test sweep and full verification

- [x] 5.1 Audit every existing test that answers `approve` on an unseen review-carrying decision and update it to mark the decision **looked** first (the new normal path) or to supply the override where the test is specifically exercising the approving action. Confirm the sites in `packages/core/src/decisions/decisions.test.ts` (notably the unseen-approval and the VS-266 supersession-lift tests), `packages/server/test/integration.test.ts`, the ticket/YOLO suites and the UI decision tests are covered. Verify no test still approves an unseen card without a review mark or override.
- [x] 5.2 `pnpm lint` clean.
- [x] 5.3 `pnpm typecheck` clean.
- [x] 5.4 `pnpm test` — both suites green; report both printed blocks verbatim with the real totals, never one block and never a summed figure.
