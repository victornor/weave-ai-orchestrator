## Why

A decision card the weaver raised can be wrong for the human who reads it: filed against the wrong
project or ticket, already settled elsewhere, or not a question for them at all. Today the only ways
to get rid of it are to answer it (which sends the weaver an answer it did not ask for) or to leave it
on Needs you forever. The `withdraw` route exists, but the card has no control for it, and a
withdrawal tells the asker nothing, so the weaver never learns the card was misplaced and cannot
re-raise it correctly or drop it.

## What Changes

- A human can dismiss an open `question`, `concern` or `gate_finding` card (the kinds an agent may
  raise with `weave_ask`), with an optional free-text reason.
- Dismissing closes the card as `withdrawn`, records who dismissed it and the reason, and wakes the
  agent that asked with a `decision_answered` wake that is marked `dismissed` and carries the reason.
  The asker's next turn is told the card was dismissed, not answered, with the reason, so it can
  re-raise a corrected card or drop the matter.
- New route `POST /decisions/:id/dismiss` (`{ reason? }`), CLI `weave decision dismiss <id> [--reason]`.
- The V2 decision card gets a **Dismiss…** control on those kinds that opens an optional reason field.
- System-raised approvals (`plan_approval`, `merge_approval`, `action_approval`, `hire_approval`,
  `discard_approval`, `retry_approval`, `promotion_approval`, `approval`) are NOT dismissible: their
  lifecycle belongs to the ticket or agent they gate, and dropping one would strand it.

## Capabilities

### New Capabilities
- `human-decisions/card-dismissal`: dismissing an agent-raised card with an optional reason, and how the asker is told.

### Modified Capabilities
- `web-v2/decision-card`: the card offers Dismiss on dismissible kinds.

## Impact

`packages/core` (decisions service, prompt rendering of the wake, API type), `packages/server`
(route, route table, inbox entry), `packages/cli` (`decision dismiss`), `packages/ui` (card, hook,
Needs you and chat wiring), plus tests for each. No schema migration: the `withdrawn` status is reused.
