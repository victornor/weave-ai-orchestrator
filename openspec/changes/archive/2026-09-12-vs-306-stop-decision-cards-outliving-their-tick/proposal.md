## Why

A decision scoped to a ticket is closed when that ticket reaches a terminal status — but only by a
transition the ticket has already made. A decision created *after* its ticket finished has no future
transition to ride and stays `open` forever: 12 decisions daemon-wide were created at or after their
ticket's terminal timestamp, 10 were later answered by hand, and 2 are still open today. The trigger
is the default, not an accident: `weave_ask` falls back to the asking agent's own `ticketId`, so a
weaver woken about a just-finished ticket and asking a follow-up silently pins the card to that
finished ticket.

The same stale cards are invisible to the weaver: its per-turn "Open decisions" list shows an id,
kind, owner and title with no age and no ticket status, so a 23-hour-old card on a `done` ticket
reads exactly like one raised a minute ago. The weaver cannot notice the problem it is best placed
to fix.

## What Changes

- **At creation:** `decisions.create()` no longer attaches a decision to a ticket that is already
  `done` or `cancelled`. The decision is still created and answerable — a follow-up about a finished
  ticket is legitimate — but with no ticket attachment, so no absent terminal transition can strand
  it. The ticket's project **and its correlation-key bucket** are both preserved (resolved from the
  finished ticket before the attachment is dropped), so the detached card neither supersedes nor is
  superseded by a workspace-level decision of the same kind. The daemon logs a warning naming the
  ticket and kind.
  (Refusing outright would break exactly the legitimate follow-up cases that produced this bug;
  warning while still attaching leaves the card orphaned; see `design.md` Decision 1.)
- **Backstop sweep:** a new decision service pass withdraws an `open` decision that is attached to a
  terminal ticket and is older than a grace period, reusing the existing
  `withdrawOpenForTicket` closure path (auditable as a withdrawal, not a new closure mechanism).
  The grace period is **24 hours** (`design.md` Decision 2). The sweep runs on the same cadence as
  the approval-integrity scan. It touches only decisions whose ticket is *already terminal* — the
  entire justification for letting it run across every decision kind — so it can never auto-close an
  approval gate on a live ticket.
- **Weaver visibility:** the per-turn prompt's "Open decisions" lines gain the decision's age and,
  for a ticket-scoped decision, the ticket's identifier and status, e.g.
  `- <id> [question, owner human, ACME-33 done, 23h] <title>`.
- The interaction with the approval-integrity repair scan is made explicit and proven: that scan
  re-raises approvals only for tickets in `proposed` / `in_review` / a non-terminal `operational`
  ticket, none of which is terminal, so the sweep cannot withdraw what it raises.
- Out of scope, and not fixed here: whether the weaver may record a human's prose answer; human-facing
  UI (age on a card, Dismiss, collapsing answered cards); default expiry.

## Capabilities

### New Capabilities
- `agent-prompts/weaver-open-decisions`: the weaver's per-turn open-decisions lines carry the age of
  each decision and the identifier and status of the ticket it is scoped to, so a stale card is
  distinguishable from a fresh one.

### Modified Capabilities
- `human-decisions/approval-integrity`: adds the creation guard (a decision is never attached to an
  already-terminal ticket) and the stale-terminal sweep (a backstop that withdraws an old `open`
  decision on a terminal ticket without ever touching a live ticket or an approval gate).

## Impact

- `packages/core/src/decisions/service.ts` — `create()` terminal-ticket guard; new sweep entry point;
  `withdrawOpenForTicket` gains an optional created-before filter so the sweep reuses it.
- `packages/core/src/api.ts` — `DecisionsService` gains the sweep method.
- `packages/core/src/supervisor/index.ts` — calls the sweep on the liveness/approval-integrity
  cadence.
- `packages/core/src/prompts/index.ts` — the weaver's open-decisions query and line formatting; uses
  `formatAge` from `@weave-ai/render` (already a `core` dependency).
- Tests: `packages/core/src/decisions/decisions.test.ts`,
  `packages/core/src/supervisor/supervisor.test.ts`,
  `packages/core/src/prompts/render.test.ts`.
- No schema/migration change; no route, CLI or UI change.
