## Context

See `proposal.md`. The two spots are small and local:

- `packages/core/src/decisions/service.ts` `create` already enqueues a wake for the weaver, but only `if (owner === 'weaver')` (line 238). Plan, merge and action approvals are owned by the human, so the branch never fires for them.
- `packages/core/src/supervisor/index.ts` `conductorDigest` keeps a `decision.created` event only when `owner !== 'human' || p.askedInRunId == null` (line 525). The second half is a proxy for "the weaver itself asked the human", and it also drops every worker-raised human-owned approval.

`carriesWeaverReview(kind)` from `@weave-ai/shared` is the same predicate the review UI uses and is already exported; the digest needs the weaver's agent id, which it fetches as `conductor` a few lines before the filter runs.

## Goals / Non-Goals

- Goal: a human-owned plan/merge/action approval wakes the weaver at creation, not up to two minutes later on a digest.
- Goal: the digest stops dropping worker-raised human-owned approvals, and still drops decisions the weaver asked.
- Goal: the wake names the decision it is about, so the review happens in the turn it wakes.
- Non-goal: changing the review mark itself, the holds it applies, or when the human may answer. This only makes the existing review prompt timely.
- Non-goal: a new wake source or event type; `system` is the source the neighbouring weaver wakes already use.

## Decisions

### 1. Wake at creation in `decisions.create`, one wake per decision

After the insert and event emit, replace the single `if (owner === 'weaver')` branch with:

- `owner === 'weaver'` → the existing wake (`decision ${kind} awaits you`), unchanged.
- otherwise, when `carriesWeaverReview(input.kind)` and `input.askedByAgentId !== conductorId()` → `decision ${kind} awaits your review`, payload `{ decisionId, ticketId }`.
- otherwise → no wake.

The `else` keeps a weaver-owned approval from enqueuing twice (the existing wake already covers it) and keeps a card the weaver itself raised quiet, per the acceptance. A human-owned card under YOLO still takes the second branch, because at creation time YOLO has not answered it yet — see Risks.

`input.askedByAgentId` is the field the decision row stores, so the suppression test is the same value the digest filter reads. A system-raised repair has no asking agent and therefore wakes, which is wanted: it is a new card for the weaver to review.

### 2. Coalescing, not a per-turn key

The wake carries `idempotencyKey: decision-review:${id}`. Per decision, not per correlation key, so a re-raised card — a different decision row — still wakes; and enqueuing the same decision twice cannot leave two live wakes. A burst of cards within one dispatch tick is collapsed by the wake service's existing queued-wake coalescing (Gate 3, `packages/core/src/wake/index.ts`), which appends each wake's payload to the queued wake's bundle. That is the "one coalesced wake, not two turns" the acceptance asks for; no new dedup mechanism is added.

The service's private `wake()` helper gains an optional `idempotencyKey` (it already centralises the try/catch and the null-agent no-op); `requestedBy` stays the default `system`.

### 3. The digest filter compares the asking agent

```
if (e.type === 'decision.created') {
  const askedBy = p.askedByAgentId ?? (p.decision as { askedByAgentId?: string | null } | undefined)?.askedByAgentId ?? null;
  return askedBy !== conductor.id;
}
```

This drops exactly the decisions the weaver asked (its own questions to the human) and keeps everything else — a worker-raised or system-raised human-owned approval, and a worker's `gate_finding`. The old `owner !== 'human'` clause is subsumed: a weaver-raised decision has `askedByAgentId === conductor.id` and is dropped; a worker-raised `gate_finding` (owner weaver) is kept, exactly as the old `owner !== 'human'` branch kept it. `conductor` is already in scope at the point the filter runs.

### 4. The prompt names the decision

`packages/core/src/prompts/index.ts` `buildTurnPrompt` renders "Why you were woken" from `flattenWakes`, which already exposes each wake's payload. For a weaver turn, when a wake's payload carries a string `decisionId`, append it to the line: `- system: decision plan_approval awaits your review (decision 01… )`. The reason already carries the kind, so id + kind is enough to find the card; the "Open decisions" list below still carries the title and age. Non-weaver turns and wakes without a `decisionId` render byte-for-byte as before.

### 5. Tests

- `decisions.test.ts` (fakeWake): `plan_approval`, `merge_approval`, `action_approval` created by a worker each enqueue exactly one weaver wake whose payload carries `decisionId`/`ticketId`; a review-carrying decision created with `askedByAgentId: conductorId` enqueues none; a `question`/`hire_approval`/`retry_approval` enqueues no review wake. Assert the wake at creation, with no digest involved.
- `decisions.test.ts` (real `createWakeService`): two review cards created before a dispatch leave one `queued` wake and one `coalesced` row — one turn.
- `supervisor.test.ts` (the digest `describe`, which already sets `weaverDigestIntervalSec = 0` and captures the digest wake): emit a worker-raised human-owned `decision.created` → kept; a weaver-raised one → dropped; a system-raised one → kept.
- A prompt test asserting the weaver's wake line for a `decisionId`-carrying wake contains the id, and an unrelated wake's line is unchanged.

## Risks / Trade-offs

- **A YOLO card wakes the weaver although the daemon answers it in the same transition.** `tickets/service.ts` creates a human-owned `plan_approval`, then `autoApprove`s it when `yolo()`; the wake is already queued, so the weaver takes a turn about an answered card. → Left as-is: the ticket scopes the wake to creation and its acceptance does not carve out YOLO, and a follow-up can suppress the wake at the YOLO call site (which is the only place that knows) if the noise matters. Noted in the PR.
- **A burst larger than the wake payload budget.** Coalescing appends every payload; a very large burst makes a large bundle. → The same bound that exists for every coalesced wake today; `flattenWakes` and the digest's `slice(0, 30)` already cap what a turn renders.
- **The digest and the immediate wake both report the same card.** Neither is removed; the digest lists it within its rate window. → Harmless duplication, and the digest list is the backstop if the wake was skipped (agent paused, workspace inactive).

## Migration Plan

No data model change, no migration, no route. The behavior starts on the running daemon after `weave daemon upgrade`; rollback is the previous release.

## Open Questions

None.
