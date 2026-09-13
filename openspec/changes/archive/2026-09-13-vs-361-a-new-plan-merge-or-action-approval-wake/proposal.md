## Why

A plan, merge or action approval card can sit unreviewed for up to two minutes. Creating a card wakes the weaver only when the weaver owns it, so a human-owned approval — every plan, merge and action card — reaches the weaver only through the rate-limited digest (`weaverDigestIntervalSec`, default 120s). On 2026-09-13 the VS-358 plan card appeared at 23:10 and the weaver woke at 23:12; captain can tap Approve before the review the card is supposed to carry has happened. The same digest filter also drops every worker-raised human-owned decision (`owner === 'human' && askedInRunId != null`), so the weaver learns of those cards only when some unrelated event happens to trigger a digest.

## What Changes

- **A review-carrying decision wakes the weaver the moment it is created.** In `decisions.create`, a `plan_approval`, `merge_approval` or `action_approval` that the weaver did not raise itself enqueues a wake immediately (`source: system`, reason naming the kind and the decision, `decisionId` and `ticketId` in the payload), keyed per decision so a re-raised card still wakes and a burst coalesces into one turn.
- **The digest drops only what the weaver itself asked.** `conductorDigest`'s `decision.created` filter compares the decision's `askedByAgentId` with the weaver's agent id instead of testing `askedInRunId == null`, so a worker's or the system's human-owned approval counts as digest news again while a decision the weaver asked stays out.
- **The wake names the decision.** The weaver's rendered wake for a decision-review wake carries the decision's id (and kind/title), so the review can happen in that turn without hunting through the open-decisions list.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `human-decisions/conductor-review`: a newly created `plan_approval`, `merge_approval` or `action_approval` that the weaver did not raise now wakes the weaver at creation, idempotently per decision and coalescing a burst into one turn; non-review-carrying kinds are unchanged.
- `worker-supervision/conductor-digest`: the digest's `decision.created` filter drops only decisions the weaver itself asked — a worker- or system-raised human-owned approval is digest news again, a weaver-raised decision is not.
- `agent-prompts/weaver-open-decisions`: the weaver's rendered wake for a decision-review wake names the decision that woke it (id, kind and title).

## Impact

- `packages/core/src/decisions/service.ts` (`create`): the wake-on-create branch, using `carriesWeaverReview` from `@weave-ai/shared`.
- `packages/core/src/supervisor/index.ts` (`conductorDigest`): the `decision.created` filter compares `askedByAgentId` to the weaver's agent id.
- `packages/core/src/prompts/index.ts` (`buildTurnPrompt`): the weaver's "Why you were woken" line names the decision from the wake payload.
- Tests: `packages/core/src/decisions/decisions.test.ts` (wake enqueued at creation for a human-owned review-carrying card; not for a weaver-raised one; not for a non-carrying kind; two cards coalesce), `packages/core/src/supervisor/supervisor.test.ts` (digest keeps a worker-raised human-owned card, drops a weaver-raised one), and a prompt test for the decision-naming wake line.
- No schema migration and no new route; `docs/API.md` and `docs/PLAN.md` are unaffected.
