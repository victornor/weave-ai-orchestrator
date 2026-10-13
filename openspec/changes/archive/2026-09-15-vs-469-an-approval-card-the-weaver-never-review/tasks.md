## 1. Re-wake the weaver while an approval stays unseen

- [x] 1.1 Add `reviewReminderScan()` to `packages/core/src/supervisor/index.ts`, run in the existing 60 s liveness block: select open, human-owned `plan_approval`/`merge_approval`/`action_approval` decisions with `weaver_review_status = 'unseen'` older than the first threshold, and enqueue a system wake to the workspace weaver naming the decision, its ticket and its age. Verify with a supervisor test that raises an unseen merge approval, advances past 10 minutes, ticks, and asserts one weaver wake carrying the decision id.
- [x] 1.2 Implement the backoff stage from the decision's age (10 min, then 40 min, then every 60 min) with the idempotency key `review-reminder:<decisionId>:<stage>`. Verify with tests that a scan before the next stage enqueues no second wake, that the next stage enqueues one more, and that a reminder coalescing into a queued weaver wake keeps the decision id in the bundle.
- [x] 1.3 Make the reminders stop when the decision is reviewed or closed. Verify by marking the decision `looked` via `decisions.review`, ticking past the next stage, and asserting no further reminder; repeat for an answered decision and for a weaver-owned decision.
- [x] 1.4 Confirm the reminder respects the run limit: it is a normal wake with no forced dispatch. Verify by asserting the wake goes through `wake.enqueue` with source `system` and no `notBefore`, and that a second decision's reminder does not start a parallel run.

## 2. List unreviewed approvals as explicit action items

- [x] 2.1 Add a bounded `pendingReview` list to `conductorDigest()`'s wake payload (`decisionId`, kind, ticket identifier, age) for open human-owned review-carrying decisions still `unseen`, and name them in the digest wake reason. Verify with a supervisor digest test that raises an unreviewed merge approval, builds a digest, and asserts the payload list and the reason both name it while a reviewed decision is absent.
- [x] 2.2 Mark the weaver's `## Open decisions` prompt lines (`packages/core/src/prompts/index.ts`) for review-carrying decisions still **not looked at yet**, leaving reviewed and non-carrying lines unchanged. Verify with prompt tests for the marked, the reviewed and the non-carrying case.

## 3. Show captain the card is waiting on the weaver

- [x] 3.1 In `packages/ui/src/v2/ticket/Ticket.tsx`, derive a waiting-on-review state from the ticket's live open approval when it is `in_review`/`proposed` and that decision is `unseen`, and show it in the header in the same terms the card uses. Verify with a `v2ticket` test for the unseen case, the clean-mark case, and the answered case.
- [x] 3.2 Add a Needs-you regression test asserting an unseen approval's card is listed with the waiting state while the actionable count is zero, and is counted after a `looked` mark. Verify `v2needs` and `v2needsCount` tests pass with VS-411's rule unchanged.

## 4. Integration test and evidence

- [x] 4.1 Add one core integration test reproducing the ACME-77 shape: raise a merge approval through the ticket transition, end a weaver run without reviewing it, then assert (a) the reminder fires after the threshold and names the decision, (b) a built digest lists it as not reviewed, (c) a mark made without calling the review service leaves the decision `unseen`, and (d) after `decisions.review(looked)` the reminders stop. Verify the test passes in `pnpm vitest run packages/core`.
- [x] 4.2 Capture uncommitted screenshots of Needs you and the ticket page with an unseen merge card at 1440 dark and 390 dark, using a scratch daemon on a loopback port other than 7433 and a scratch config dir. Report the absolute paths on the ticket; keep the files outside `work/`.

## 5. Verify and deliver

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, and paste both suite blocks verbatim in the report. Verify `git status --porcelain` in the worktree is empty before requesting review.
- [x] 5.2 Open the PR describing the change and the acceptance evidence, and record it as the ticket's work product.
