# ADR 0010 — A usage limit is not retried automatically

**Status:** accepted · 2026-09-05 · supersedes the `provider_quota` half of PLAN §7.2 step 8

## Context

`docs/PLAN.md` §7.2 step 8 says finalize schedules a `retry` wake with backoff (30 s, 2 min, 10 min;
max 3) when `error_family` is `transient_upstream` **or** `provider_quota`, and PLAN §7.1 records the
ladder on `runs.retry_of_run_id`.

Neither half worked. Nothing wrote `retry_of_run_id` — the four producers of a retry put
`retryOfRunId` in the wake payload and the dispatcher inserted the run without it — so `countRetries`
read zero forever, `attempt < maxAttempts` always held, and both families re-queued indefinitely.
VS-56 makes the dispatcher record the link, which ends the ladder. That immediately raises the
question the PLAN answers wrongly: should a usage limit climb it at all?

## Decision

`provider_quota` leaves the retried families. A usage-limit failure parks the worker on its first
occurrence: the worker is paused with the family and the runtime's message recorded, its ticket is
blocked, and the human gets the `retry_approval` card.

The card no longer books an attempt by itself either. When the runtime reported a reset time the card
says so and offers "retry when the limit resets" as an option; when it did not, it offers "retry in
an hour" as before. If the human chooses neither, the worker stays parked and nothing is spent.

`transient_upstream` is unchanged: three attempts, 30 s / 2 min / 10 min, and now an ending.

## Why

- A quota is not transient the way an upstream 503 is. The runtime has already told us the window is
  exhausted; it is a statement about the next hours, not about this second. Three more attempts at
  rising delay are guaranteed to fail and to arrive at exactly the same card, having spent a turn
  each time.
- The workspace owner's direction on VS-56 was explicit: stop, surface the reason, and let the human
  resume once they have resolved the limit. Booking an attempt nobody asked for is the spend that
  direction removes.
- The reset time the runtime reports is better used as an offer than as a booking. It is a hint from
  the provider, not consent from the human, and a limit the human has topped up or moved to another
  runtime should not be re-hit by a timer they never saw.

## Consequences

- A quota failure produces a card immediately rather than after ~13 minutes of retries. That is the
  point; the card supersedes rather than accumulating, so a flapping runtime still yields one card.
- A runtime that misclassifies a one-off 429 as `provider_quota` now stops work that would previously
  have recovered by itself. The card's "Retry now" is one click, and classification stays with the
  adapters — VS-56 explicitly did not touch it.
- Anything reading PLAN §7.2 step 8 for the retried families must read this ADR with it.
