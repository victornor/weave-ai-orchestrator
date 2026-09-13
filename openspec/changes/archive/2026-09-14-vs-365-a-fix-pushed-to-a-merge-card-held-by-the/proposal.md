## Why

On 2026-09-13 the weaver marked PR #304's `merge_approval` **looked at, with concerns** for a real bug (22:39). One minute later the worker pushed the fix (`15dc6f31`) and ended its turn without commenting. The only wake that reaches a held review when it is being addressed comes from a worker **comment** (VS-275), never from a pushed commit, so nothing woke the weaver; the card stayed held and the fix unreviewed until an unrelated digest turn at 22:46, and captain could not approve the ticket. A fix pushed to a held merge card has to wake the weaver by itself.

## What Changes

- **The head the review was made against is recorded.** Every `merge_approval` review mark stores the delivery head SHA that existed at review time, on the decision itself, so “the head moved since the review” is exact.
- **A moved head wakes the weaver once per commit.** At the end of a worker's turn, and on the daemon's existing PR reconcile pass, an open `merge_approval` marked **looked at, with concerns** whose delivery head now differs from the recorded one enqueues exactly one weaver wake, idempotent under `held-review:<decisionId>:<sha>`, naming the ticket and the new commit. Re-observing the same head wakes nobody; a second new commit wakes again.
- **The delivery head is resolved generally.** The PR's head when a pull request exists, the worker worktree's branch head otherwise, and the project clone's branch ref as a last resort — nothing GitHub-specific is assumed, and local-branch delivery works without a PR. The forge adapters report a PR's head for the reconcile path.
- **The worker is told to say so too.** `skills/weave-ai-worker/SKILL.md` tells the worker to leave a short ticket comment naming the fix commit after pushing a fix to held merge concerns, so the existing VS-275 comment wake fires as well.
- **Unchanged:** who owns merge approval, how an override works, and what lifts a hold. Plan-approval behaviour is untouched — VS-364 covers plans.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `human-decisions/conductor-review`: a held merge approval whose delivery head moves after the review wakes the weaver, once per new head, and the head the review was made against is recorded on the decision.

## Impact

- `packages/db/src/migrations/0036_decision_reviewed_head.sql` — `weaver_reviewed_head_sha` on `decisions`.
- `packages/shared/src/types.ts` — `Decision.weaverReviewedHeadSha`.
- `packages/core/src/decisions/service.ts` — `review()` records the head; `packages/core/src/api.ts` — the `review()` input and two new `TicketsService` members (`deliveryHead`, `noteHeldReviewHead`).
- `packages/core/src/tickets/service.ts` — resolve the delivery head and raise the idempotent wake.
- `packages/core/src/runs/engine.ts` — check at the end of a worker's turn (beside VS-364's turn-end hook, folded into it if it has landed).
- `packages/core/src/supervisor/index.ts` — check on the PR reconcile pass.
- `packages/plugin-sdk/src/index.ts` + `packages/core/src/forge/gh.ts` — `prState` reports the PR head.
- `packages/server/src/tools.ts` — `weave_decision_review` resolves the head before the (still synchronous) mark.
- `skills/weave-ai-worker/SKILL.md` — the worker-side comment instruction.
- Tests: a new `packages/core/src/tickets/held-review-head.test.ts`; additions to `decisions.test.ts`, `engine.test.ts`, `supervisor.test.ts`, `gh.test.ts`, `migrations.test.ts`.
