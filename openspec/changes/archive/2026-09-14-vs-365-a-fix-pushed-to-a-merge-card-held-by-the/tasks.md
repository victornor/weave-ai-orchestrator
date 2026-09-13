## 1. Record the reviewed head

- [x] 1.1 Add `packages/db/src/migrations/0037_decision_reviewed_head.sql` (`ALTER TABLE decisions ADD COLUMN weaver_reviewed_head_sha TEXT;`) — 0036 is claimed by PR #302, so this takes the next free number and the PR says so, add `weaverReviewedHeadSha: string | null` to `Decision` in `packages/shared/src/types.ts`, and update the manual `Decision` literals in `packages/render/src/decision.test.ts`, `packages/server/test/fakes.ts`, `packages/ui/src/test/factories.ts`, `packages/ui/src/test/events.test.tsx` and `packages/ui/src/test/v2chat.test.tsx`. Verify the column round-trips in `packages/db/src/migrations.test.ts` and that `pnpm typecheck` compiles.
- [x] 1.2 Add optional `reviewedHead?: string | null` to `DecisionsService.review` in `packages/core/src/api.ts` and persist it to `weaver_reviewed_head_sha` in `packages/core/src/decisions/service.ts`. Verify in `packages/core/src/decisions/decisions.test.ts` that a mark stores the given head, a mark without one stores `null`, and plan/action/merge marks still succeed.
- [x] 1.3 Make the `weave_decision_review` handler in `packages/server/src/tools.ts` async and, for a `merge_approval` with a ticket, resolve `svc(ctx).tickets.deliveryHead(d.ticketId)` and pass it as `reviewedHead`; verify in the server tools tests that the resolved head reaches the stored decision.

## 2. Resolve the delivery head

- [x] 2.1 Add `deliveryHead(ticketId: string): Promise<string | null>` to `TicketsService` (`packages/core/src/api.ts`) and implement it in `packages/core/src/tickets/service.ts`: the PR head when the ticket has a PR work product and the forge reports one, else the active worktree's `git rev-parse HEAD`, else the project clone's branch ref; `null` when nothing resolves and never throws. Verify with a test that uses a real temporary git repo in the harness worktree, plus a null case.
- [x] 2.2 Extend the forge contract with optional `headSha?: string` on `ForgeAdapter.prState` (`packages/plugin-sdk/src/index.ts`) and return `headRefOid` from `GhForge.prState` (`packages/core/src/forge/gh.ts`, add it to the `--json` field list). Verify in `packages/core/src/forge/gh.test.ts` that a recorded document maps its `headRefOid` and that a document without the field yields `headSha: undefined`.

## 3. The idempotent wake

- [x] 3.1 Add `noteHeldReviewHead(actor: Actor, ticketId: string, head?: string | null): Promise<{ woken: boolean; decisionId?: string; headSha?: string }>` to `TicketsService` (`packages/core/src/api.ts`) and implement it in `packages/core/src/tickets/service.ts`: find the newest open `merge_approval` with `weaver_review_status = 'concerns'`; return without resolving anything when there is none; default `head` to `deliveryHead(ticketId)`; no-op when `head` is null or equals the recorded head; baseline (record without waking) when the recorded head is null; otherwise enqueue a `source: 'system'` wake keyed `held-review:<decisionId>:<sha>` whose reason names the ticket and the new commit. Never throw; leave the review state untouched.
- [x] 3.2 Add `packages/core/src/tickets/held-review-head.test.ts` covering: a moved head wakes exactly once, naming the ticket and the commit and carrying the decision id and new head; the same head wakes nobody; a second new commit wakes once more; a `looked` mark and an unreviewed card wake nobody; a `plan_approval` marked concerns wakes nobody; the head recorded at review waking nobody; a null recorded head baselining without a wake; and the wake leaving the decision `open`/`concerns`.

## 4. Hooks

- [x] 4.1 In `packages/core/src/runs/engine.ts`, invoke the check at the end of a worker's turn at the finalize sites. If VS-364's `republishPlanAfterTurn` has landed by apply time, extend that hook; otherwise add a sibling turn-end hook and fold it in on rebase. Verify in `packages/core/src/runs/engine.test.ts` with a spy that a worker turn on a ticket calls it once and a turn with no ticket does not.
- [x] 4.2 Invoke the check on the supervisor's PR reconcile pass (`packages/core/src/supervisor/index.ts`) for each `in_review` ticket with a pull request. Verify in `packages/core/src/supervisor/supervisor.test.ts` that a held concerns merge card whose PR head moved wakes the weaver once and one whose head is unchanged does not.
- [x] 4.3 Confirm the existing decision-hold tests (VS-266/VS-281) and the VS-275 comment-wake tests still pass unchanged.

## 5. Instructions and verification

- [x] 5.1 Add to `skills/weave-ai-worker/SKILL.md` (delivery section): after pushing a fix to a held merge concern, leave a short ticket comment naming the fix commit, so the VS-275 path also fires.
- [x] 5.2 Run `openspec validate vs-365-a-fix-pushed-to-a-merge-card-held-by-the --json --strict`, then `pnpm lint && pnpm typecheck && pnpm test`, and paste both suite blocks verbatim in the report.
