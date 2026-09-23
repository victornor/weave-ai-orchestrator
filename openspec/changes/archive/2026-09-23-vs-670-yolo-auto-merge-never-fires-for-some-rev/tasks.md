## 1. Resolve a ticket's project through its role

- [x] 1.1 In `packages/core/src/tickets/service.ts`, add a `projectFor(t)` helper that returns the ticket's own project when set, otherwise the project of its `assigneeRoleId` when that role is project-scoped. Use it in `yolo(t)`, in the policy lookup `autoMergeSweep` uses for its CI gate, and in `resolveApprovalHead`/`resolveDeliveryHead` where they currently read `project(t.projectId)`.
- [x] 1.2 Add a failing test in `packages/core/src/tickets/yolo.test.ts`: a YOLO ticket created with `projectId` null and a project-scoped `assigneeRoleId` is delivered, the weaver marks its merge card looked at the current head, and `autoMergeSweep()` grants it and moves the ticket to `merging`. Also assert a ticket with neither project nor a role still reads the mode as off.

## 2. The decision-centric safety sweep

- [x] 2.1 Add `staleReviewSweep()` to `packages/core/src/tickets/service.ts` with `STALE_REVIEWED_APPROVAL_MS` (10 minutes): scan open `plan_approval`/`merge_approval` decisions whose `weaver_review_status` is `looked`/`concerns` and whose `weaver_reviewed_at` is older than the threshold, resolve each ticket's project through `projectFor`, and act only when the mode is on. Grant a `looked` card that has no other periodic grant path (a plan, or an archive-backfill merge) via the existing `autoApprove`; leave an ordinary merge to `autoMergeSweep`; surface anything still unresolved once.
- [x] 2.2 Add the once-per-card surface: a system comment naming the decision id, review state and elapsed minutes, plus a weaver wake under the idempotency key `stale-reviewed-approval:<decisionId>`, recorded in the ticket's `delivery` JSON so it does not repeat on every tick.

## 3. Wiring and tests

- [x] 3.1 Declare `staleReviewSweep(): Promise<number>` on `TicketsService` in `packages/core/src/api.ts` and call it from the supervisor tick immediately after `autoMergeSweep`, behind the same `typeof … === 'function'` guard so a `tickets` stub that omits it is unaffected.
- [x] 3.2 Add `packages/core/src/tickets/stale-review-sweep.test.ts` covering: a back-dated `looked` plan (or archive merge) card left open is granted by the sweep; a back-dated `looked` ordinary merge card is surfaced once (comment + single weaver wake) and a second sweep does not repeat; a back-dated `concerns` card is surfaced once and never granted; a card on a project with the mode off and a card that is still `unseen` are untouched.
- [x] 3.3 Add a supervisor test (`packages/core/src/supervisor/supervisor.test.ts`) that stubs `tickets.staleReviewSweep` and asserts the tick calls it, and confirm the existing stubs without the method still pass.

## 4. Acceptance and VS-665

- [x] 4.1 State in the PR whether VS-665 self-corrected at upgrade or needed a manual nudge, and note that it was not verified against the live daemon (worker rules forbid driving it).

## 5. Checks

- [x] 5.1 Run `pnpm lint && pnpm typecheck` and the changed test files, then run the full `pnpm test` once and paste both suite blocks verbatim in the PR.
