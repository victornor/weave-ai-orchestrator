## Why

The Work screen knows three facts it does not show. Every ticket in Done reads "unassigned"
because the label comes from the live worker, which a landed ticket no longer has — so "nobody did
this" is printed over work a role completed. The merge queue is serial and priority-ordered, yet
every `merging` ticket looks the same, and the summary ("1 landing · 3 waiting") names nobody, so
captain cannot tell which ticket holds the slot, what it is waiting on, or which one is next. And a
scout a planning agent dispatched mid-drafting looks identical to one the weaver filed at plan
submission, though the board already links the ticket to its plan draft through
`plan_drafts.created_ticket_id`.

## What Changes

- **Done tickets name the role that did them.** The assignee label falls back from the live worker to
  the ticket's own `assigneeRoleId` (resolved to the role name) when no worker is live. A ticket with
  no live worker and a known role reads the role; a ticket with no role at all still reads
  "unassigned"; an in-progress ticket keeps showing its live worker exactly as today. The same label
  appears on the kanban card, the table row, the phone row and the ticket page.
- **The board distinguishes landing from waiting, and names the queue order.** A `merging` ticket
  with `merge_started_at` is marked as landing and states what it is waiting on ("on CI" while checks
  are pending, else "on the worker", with elapsed time); one without it is marked as waiting and
  shows its 1-based position in its project's queue, computed with the shared `compareMergeQueue`
  order the daemon already uses. The distinction is read from `merge_started_at`, never inferred from
  status.
- **The merge summary reaches the tickets it counts.** The strip's landing count, waiting count,
  active landing ticket and next waiting ticket each link to the ticket(s) they refer to instead of
  being dead text.
- **Plan origin is shown, with the dispatch case called out.** A ticket linked to a plan draft shows
  the plan's name on its card and its own page, and distinguishes a ticket dispatched while the plan
  was still drafting from one created at submission. A ticket with no plan behind it shows nothing
  extra. The plan name links to where a plan is opened today (the weaver chat), not a new viewer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-v2/work`: the board gains an assignee label that falls back to the role, the merge
  landing/waiting/position state per card, a summary whose counts link to their tickets, and a plan
  origin tag on cards.
- `web-v2/ticket-page`: the ticket page names the role when no worker is live and shows the ticket's
  plan origin.
- `planning-sessions/scout-dispatch`: its "a dispatched scout is displayed independently of who
  dispatched it" requirement changes — the ticket's plan provenance (plan named, early dispatch
  distinguished from submission-time filing) is now shown.

## Impact

- `packages/core/src/planning/index.ts` — a plan-origin read (`planOriginForTicket`,
  `listPlanOrigins`) over `plan_drafts` joined to `plans`; `packages/core/src/api.ts` for the type.
- `packages/server/src/routes/tickets.ts` — `plan` on the ticket detail response; a workspace-scoped
  `plan-origins` read for the board. `docs/API.md` for both.
- `packages/ui/src/api/hooks.ts`, `packages/ui/src/api/types.ts` — the hooks and types for the two
  reads.
- `packages/ui/src/lib/board.ts` and `packages/ui/src/v2/work/board.ts` — the pure assignee-label and
  merge-state functions; `packages/ui/src/v2/work/Work.tsx` renders them and links the strip.
- `packages/ui/src/v2/ticket/Ticket.tsx` — role fallback and plan-origin row.
- Tests in `packages/core`, `packages/server` and `packages/ui`; rendered captures for both themes at
  desktop and phone width, attached to VS-550.
