## Context

`PlanTab.tsx` already renders the planner conversation through the same `ChatConversation` component
the weaver chat uses (VS-556/VS-442), including `chatRows(chatEntries(messages, tickets, workers).entries, traces, ...)`.
Today it calls `chatEntries(messages.data ?? [], [], [])` — empty ticket and worker lists — so
`referencesFor` (in `packages/ui/src/lib/dispatch.ts`) can never resolve a mentioned identifier or an
anchored dispatch to a real `Ticket`/`Agent`, and `V2TicketStrip` is never mounted at all. `ChatPage.tsx`
already fetches the workspace's tickets (`useTickets({ limit: 200, includeTerminal: true, fields: 'label' })`)
and workers (`useWorkers({ includeRetired: true })`) unconditionally (not only while the weaver tab is
focused), for its own `chatEntries` call.

A dispatched scout's ticket gets `createdRunId` set to the planner's current run (`tickets.create`
stamps `actor.runId`), and its `assigneeRoleId` is set immediately (`dispatchDraft` passes
`draft.targetRoleId`), so `chatEntries`'s existing `dispatched` filter (`t.createdRunId && isDispatched(t)
&& byRun.has(t.createdRunId)`) already matches it — the same mechanism that anchors a weaver dispatch,
with no changes needed to `dispatch.ts` itself. `byRun` only contains a run if that run produced an
outbound message, so the chip additionally depends on the planner replying in the same turn it
dispatched — see Decisions below.

The dispatch tool, `weave_plan_draft_dispatch` (`packages/server/src/tools.ts`), returns the bare
`PlanDraft`, whose only ticket-shaped field is `createdTicketId` (an internal id, not the `PREFIX-n`
identifier `ticketIdentifiersIn` parses or a human would recognize).

## Goals / Non-Goals

**Goals:**
- Reuse `V2TicketStrip`/`V2DispatchChip`/`TicketChipPanel` unmodified — no second chip implementation.
- Make the chip's presence independent of whether the planner's prose names the ticket.
- Give the planning agent the ticket identifier at the point it dispatches, not on a later poll.

**Non-Goals:**
- Changing how a plan's draft list (the right-hand pane) shows a dispatched draft's own status — that
  is `DispatchedPlanDraft`/`d.ticketStatus`, already live (VS-517), and untouched here.
- Guaranteeing a chip when a planner turn dispatches but sends no reply at all in that turn. That
  gap already exists for the weaver chat (a dispatch anchors only to a run that produced a message);
  this change does not add new anchoring logic, only wires real data into the existing one.

## Decisions

**Fetch tickets/workers in `PlanTab` itself, with the same query params `ChatPage` uses, rather than
threading them down as props.** `ChatPage` calls `useTickets`/`useWorkers` unconditionally (above the
weaver/planner ternary), so when a plan tab is focused those queries are already warm in the shared
`QueryClient`; calling the same hooks with identical params (`{ limit: 200, includeTerminal: true,
fields: 'label' }` / `{ includeRetired: true }`) inside `PlanTab` reuses that cache entry rather than
issuing a second request, and keeps `PlanTab` self-contained the way its other data (`useRoles`,
`useRunTraces`, `useRuntimeModels`) already is, instead of widening `PlanTabProps` for a wiring detail.
Alternative considered: pass `tickets`/`workers` down as new props from `ChatPage` — rejected because
it makes `PlanTabProps` depend on a fetch shape `PlanTab` can equally own itself, for no cache benefit
either way (query keys already dedupe).

**Derive the chip from the dispatch link (`chatEntries`'s existing `dispatched`/`createdRunId` path),
not by having the UI additionally scan the draft list for `createdTicketId`.** The ticket is already
correctly anchored once real data flows in; adding a second, draft-list-based anchoring path would be
a duplicate source of truth for the same fact and risks double-chipping a ticket that is both dispatched
and named in the reply (guarded today by `referencesFor`'s `seen` set, which a second path would have
to replicate). This is why the required planner-instructions fix (naming the identifier) matters
operationally even though it is not what makes the chip appear: it ensures the dispatching turn's reply
exists as a message, which is what the chip anchors to.

**Add `ticketIdentifier` to `weave_plan_draft_dispatch`'s result by looking up the created ticket in
the handler, rather than changing `PlanningService.dispatchDraft`'s return type.** `dispatchDraft`
returns a `PlanDraft` and is shared with captain's own dispatch path (`POST
.../drafts/:draftId/dispatch`, `packages/server/src/routes/projects.ts:299`); widening the core
service's return shape would change that route's response too, for a field only the agent tool needs.
The tool handler already has `svc(ctx).tickets.get` available (used the same way by other planner
tools' handlers), so it composes the field at the edge instead.

## Risks / Trade-offs

[A planner turn dispatches a scout but ends without calling `weave_plan_reply`] → No message exists
for that run, so `chatEntries` has nothing to anchor the chip to and it does not render — the same
limitation the weaver chat already has for a silent dispatch. Mitigated, not eliminated, by the
instructions change: the planner's system prompt already says `weave_plan_reply` is the *only* way
its words reach captain, and the added instruction to name the identifier gives it a concrete reason
to call it every time it dispatches.

[Re-fetching tickets/workers inside `PlanTab` in a context where `ChatPage`'s own fetch has not run
first — e.g., a future caller of `PlanTab` outside `ChatPage`] → The query still runs on its own; it
is a normal `useTickets`/`useWorkers` call, just not free of a network round-trip in that hypothetical
context. No behavior regression, only a missed cache hit.

## Migration Plan

No data migration. `weave_plan_draft_dispatch`'s result gains a field; no consumer of the existing
`PlanDraft` shape reads or breaks on an unknown extra key.
