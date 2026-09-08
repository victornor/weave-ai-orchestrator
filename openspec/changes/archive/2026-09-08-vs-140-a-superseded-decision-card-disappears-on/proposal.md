## Why

Captain pressed Approve on a plan-approval card the instant after a worker's revision superseded it.
The card was still on screen, so the approve looked live; the answer failed with `decision <id> is
superseded` and nothing told them what had actually happened to the plan they read, or that a newer
one existed. For a `plan_approval`, that ambiguity is the worst possible outcome: they could not tell
whether they had just authorised state-changing work on a production host.

Investigation (see `design.md`) found the server-to-client sync path for `decision.superseded` /
`decision.answered` / `decision.expired` is wired correctly end to end — server emits, the SSE bus
carries it, the client invalidates the right query keys, and every list (chat's pinned area, Needs
you) is filtered from that same query. The workspace SSE stream (`packages/ui/src/api/events.ts`)
has no independent liveness check, though: it trusts the browser's own `error`/`open` events
exclusively, so a connection that goes silently stale without the browser noticing loses every event
until something else causes a reconnect, and nothing today forces the decisions list back to
authoritative once the connection *does* recover from an unrelated cause. That is the most likely
explanation for the card surviving its own supersession, and it is fixed the same way regardless of
what exactly stalled the connection that day: make the client apply an already-known decision update
synchronously instead of waiting on a round trip, and make it reconcile against the server the moment
a connection comes back, rather than trusting whatever was already invalidated.

Separately, and independent of the above, acting on a card that has already left `open` status
reports a raw internal message with no path forward. That is fixed regardless of root cause too.

## What Changes

- The client applies a `decision.superseded` / `decision.answered` / `decision.expired` event to
  every cached decisions-list query directly, from the event's own payload, instead of only
  invalidating and waiting for a refetch — closing the round-trip window during which a card the
  server has already moved on from is still shown.
- Reconnecting the workspace SSE stream (after any drop, of any cause) always refetches the open
  decisions the human is currently looking at, rather than relying solely on event replay.
- `decisions.answer()` refuses an action on a decision that is not `open` with a `wrong_status` error
  that names what happened (superseded, answered elsewhere, or expired) and, when the decision was
  superseded, the id of the decision that replaced it.
- The web app turns that refusal into a message in the human's terms — "This plan changed while you
  were looking at it" style copy, not the raw error — and, when a replacement exists, a way to go
  straight to it.
- A stale answer is never applied to any decision other than the one the human actually pressed
  approve on; this is already true structurally (`answer()` keys strictly off the id in the request)
  and this change adds a test that pins it down as a guarantee rather than an accident of the current
  code path.

## Capabilities

### New Capabilities

- `human-decisions/live-visibility`: an open decision that stops being `open` (superseded, answered
  by someone else, expired, or withdrawn) leaves every view that lists decisions without a reload,
  and the workspace event stream reconciles the decisions list to the server's state whenever its
  connection recovers from a drop.

### Modified Capabilities

- `human-decisions/approval-integrity`: acting on a decision that has already left `open` status is
  refused with a message naming what happened and, when the cause was supersession, the replacement's
  id — and a stale action never applies to any decision other than the one it targeted.

## Impact

- `packages/ui/src/api/events.ts` — `invalidateFor` patches cached decision list/detail queries
  directly for the three terminal-status events; the SSE stream's reconnect path triggers a decisions
  refetch.
- `packages/ui/src/routes/Chat.tsx`, `packages/ui/src/routes/NeedsYou.tsx` — stale-answer error
  handling produces a human-readable message and, where applicable, a way to navigate to the
  replacement decision.
- `packages/ui/src/components/Toast.tsx` — toasts gain a labelled action button (generalising the
  existing `undo` affordance) so the stale-answer toast can offer "View the new one".
- `packages/core/src/decisions/service.ts` — `answer()`'s `wrong_status` error carries structured
  detail (the decision's terminal status, and the replacement id when superseded).
- Tests: `packages/core/src/decisions/decisions.test.ts`, `packages/ui/src/test/events.test.tsx`,
  `packages/ui/src/test/chat.test.tsx`, `packages/ui/src/test/needsyou.test.tsx`.
