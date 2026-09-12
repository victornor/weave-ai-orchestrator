## Context

See `proposal.md` — Why. The VS-266 hold keeps an approving answer refused while a `weaverReviewStatus === 'concerns'` decision is `open`, and the worker's fix lands as an ordinary ticket comment. `tickets/service.ts`'s `comment()` is the single choke point every ticket comment passes through, and it already reads the actor and the ticket and owns the existing comment-wake routing, so it is the natural insertion point.

## Goals / Non-Goals

**Goals:**
- The weaver receives exactly one wake when a worker has answered a concern it raised.
- The wake is self-describing: the weaver knows which ticket and which decision to re-read without opening anything first.
- The hold stays a hold: nothing about the notification changes review state.

**Non-Goals:**
- Automatically clearing or downgrading `weaverReviewStatus` — that is only ever the weaver's judgement via `ac_decision_review`.
- Changing the VS-266 answer gate, the human override, or any decision-service code.
- Attaching the wake to *every* agent comment or every open decision.

## Decisions

**Fire on any agent comment that is not the weaver's, including `status` comments.** A worker reports a completed fix in either a prose reply or a `status` line, and the two are not distinguishable from content alone; the trigger is already narrowed by "the ticket has an open concern-marked decision", which is the condition that matters. Narrowing further to non-`status` kinds was the alternative and is rejected because it would drop the common case where the worker writes "fixed in <sha>" as a status comment.

**Identify the weaver by `conductorId()` at wake time.** The author check is `actor.kind === 'agent' && actor.id != null && actor.id !== conductorId()`. This reuses the same workspace-scoped lookup `transition()` already uses for the `ticket_blocked` wake, so the weaver is woken on a live workspace rather than a stale role.

**Use the existing `ticket_comment` wake source and the existing decision lookup.** No new `WakeSource` and no new `DecisionsService` method: `deps().decisions.list({ ticketId, status: ['open'] })` already returns the ticket's open decisions with `weaverReviewStatus` on each. The wake reason names the ticket and says the held review was answered; the payload is `{ ticketId, commentId, decisionId }`. One wake per comment: the lookup takes the first match, which is enough because the wake's job is to make the weaver look, not to enumerate.

**Enqueue inside `comment()`'s transaction, after the comment row is inserted**, beside the existing human-comment branch, guarded by an `else if` on the agent author so the human paths are left byte-for-byte untouched. `wake()` already swallows its own enqueue failures, so a wake-queue error cannot fail the comment write.

## Risks / Trade-offs

- **A worker's routine status chatter on a concern-marked ticket wakes the weaver once per comment.** → In practice a ticket has at most one open concern-marked decision and the worker tends to comment once when it has something to report; the trigger is deliberately not "any open decision". If it proves noisy, the documented narrowing is to non-`status` kinds.
- **The weaver wakes, re-reads, and decides the concern is unresolved.** → Correct and intended: the wake makes the weaver look, the mark is what moves the state. No auto-clear means a false alarm costs one review and never a wrongly-approved card.
- **A comment posted concurrently with the decision being answered could race the open-check.** → The lookup and the enqueue happen in the same synchronous comment call; in the worst case the weaver gets a wake for a decision that was answered a moment earlier, which its next turn observes immediately and discards.

## Migration Plan

None. No schema change, no stored state, no deploy ordering dependency.
