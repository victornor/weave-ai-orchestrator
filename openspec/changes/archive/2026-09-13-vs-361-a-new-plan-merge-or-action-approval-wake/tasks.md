## 1. Wake the weaver at creation

- [x] 1.1 In `packages/core/src/decisions/service.ts`, extend the private `wake()` helper with an optional `idempotencyKey` and pass it through to `deps().wake.enqueue`; run `pnpm typecheck` to confirm it compiles.
- [x] 1.2 In `create`, import `carriesWeaverReview` from `@weave-ai/shared` and replace the single `if (owner === 'weaver')` wake with: keep that branch unchanged; otherwise, when `carriesWeaverReview(input.kind)` and `input.askedByAgentId !== conductorId()`, enqueue `source: 'system'`, reason `decision ${input.kind} awaits your review`, payload `{ decisionId: id, ticketId }`, `idempotencyKey: decision-review:${id}`; otherwise enqueue nothing. Verify `pnpm typecheck`.
- [x] 1.3 In `packages/core/src/decisions/decisions.test.ts` (fakeWake), assert that a worker-raised `plan_approval`, `merge_approval` and `action_approval` each enqueue exactly one weaver wake at creation whose payload carries the decision id and ticket id with no digest involved; that a review-carrying decision created with `askedByAgentId: h.conductorId` enqueues none; and that a `question`, `hire_approval` and `retry_approval` enqueue no review wake.
- [x] 1.4 Add a test using the real `createWakeService` (two review cards created before any dispatch) asserting one `queued` wake and one `coalesced` row — one turn, not two.

## 2. The digest keeps worker-raised approvals

- [x] 2.1 In `packages/core/src/supervisor/index.ts` `conductorDigest`, replace the `decision.created` filter with a comparison of the decision's `askedByAgentId` against `conductor.id` (drop only when equal), removing the `owner !== 'human' || askedInRunId == null` test. Verify `pnpm typecheck`.
- [x] 2.2 In the `conductor digest` describe of `packages/core/src/supervisor/supervisor.test.ts` (which already sets `weaverDigestIntervalSec = 0`), emit `decision.created` events and assert the digest wake's event list keeps a worker-raised human-owned approval and a system-raised one, and drops a weaver-raised one.

## 3. The wake names the decision

- [x] 3.1 In `packages/core/src/prompts/index.ts` `buildTurnPrompt`, for a weaver turn, append the decision id to a wake line when the wake's payload carries a string `decisionId`; leave non-weaver turns and wakes without a `decisionId` unchanged. Verify `pnpm typecheck`.
- [x] 3.2 In `packages/core/src/prompts/render.test.ts`, assert the weaver's "Why you were woken" line for a `decisionId`-carrying wake contains that id, and that a wake without one renders as before.

## 4. Validate and run the suites

- [x] 4.1 Run `openspec validate vs-361-a-new-plan-merge-or-action-approval-wake --json --strict` and fix any item.
- [x] 4.2 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks verbatim in the report; this touches core, so both must be green.
