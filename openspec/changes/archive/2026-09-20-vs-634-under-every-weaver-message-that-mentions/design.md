## Context

See proposal.md — Why. Relevant current state:

- `packages/ui/src/lib/dispatch.ts` is the chat's view model. `chatEntries(messages, tickets,
  workers, decisions)` returns one `ChatEntry` per message with `dispatches: Dispatch[]`, anchored
  only for tickets a turn *filed* (`createdRunId`) and *assigned* to a role, matched against the run
  behind the last outbound message. It also returns `unattributed: Agent[]` — live workers no
  anchored dispatch accounts for — which `ChatPage` renders as the row below the conversation.
- `packages/ui/src/v2/ChatChips.tsx` holds `V2DispatchChip` (identifier, worker name or ticket
  title, status glyph/word) and `V2WorkerChip`. `ChatPage.renderAfterTrace(entry)` renders the
  dispatch chips into a `data-v2-dispatch-row`; a chip with a worker calls `openWorker`, otherwise
  `openTicket`. `ChatPage.footer` renders `unattributed` as `V2WorkerChip`s.
- `packages/ui/src/lib/ticketLinks.ts` owns the one identifier pattern (`TICKET_IDENTIFIER`) and
  `linkTicketIdentifiers`, which rewrites identifiers to `[ID](#ticket:ID)` outside inline code spans
  and fenced blocks (VS-623). `packages/ui/src/v2/ticket/TicketModal.tsx`'s `useTicketLink` is the one
  click handler — modal on desktop (≥768px), navigation on phone.
- `packages/ui/src/v2/ChatPage.tsx` already loads `useTickets({ limit: 200, includeTerminal: true,
  fields: 'label' })` and `useWorkers({ includeRetired: true })`. `packages/ui/src/api/events.ts`
  invalidates `qk.tickets(ws)` on every `ticket.*` event and `qk.workers(ws)` on every `worker.*`
  event, so both queries are already live.
- `ChatConversation` takes weaver-only extras as render props; `PlanTab` (planner) passes none, and
  `WorkerPage`/session turns do not use `ChatConversation` at all. `V2ChatsScreen` renders one
  `V2ChatPage` per workspace pane, so the weaver chat and the global chats share one implementation.

## Goals / Non-Goals

**Goals:**

- Compute, per weaver message, the ordered, de-duplicated set of tickets it references (text
  identifiers ∪ anchored dispatches), resolved to real tickets.
- Render it as one compact, capped, expandable strip under the message, with the live status and the
  acting name, using the existing chip recipe.
- Put it in the shared chat so the weaver chat and global chats get it, leave the planner chat and
  session transcripts untouched, and narrow the bottom row to genuinely unaccounted workers.
- Keep status live via the queries/events already in place; no new route, polling or connection.

**Non-Goals:**

- No second identifier pattern, click handler, chip recipe or ticket view.
- Not resolving identifiers outside the tickets the chat already loaded (see D7).
- Not changing worker/planner transcripts, the modal, or any delivery rule.
- Not preserving the old "a dispatch chip opens the worker" behaviour — the ticket requires a chip to
  open its ticket through the shared handler (D4).

## Decisions

### D1. Compute references in the view model, not the component

`lib/dispatch.ts` gains an entry-level `references: Dispatch[]`, built as the union of:

1. the ticket identifiers found in the message body, in order of first mention, de-duplicated; and
2. the anchored `dispatches` not already named, in dispatch order.

Each identifier is resolved through an identifier→ticket map of the `tickets` passed to
`chatEntries`; an identifier with no ticket is dropped. Each reference becomes a `Dispatch` with the
same `{ ticket, worker, status }` shape `dispatches` already uses, so the strip reuses one model.
`dispatches` stays as the anchored-only list (the dispatch-labels anchoring requirement still holds)
and `references` is what the strip renders.

`anchored` — the set that decides `unattributed` — is broadened from "tickets with an anchored
dispatch" to "any ticket a message chips", so a worker whose ticket is merely mentioned by a message
no longer doubles up in the bottom row.

The identifier extraction needs a code-aware helper. `lib/ticketLinks.ts` gains
`ticketIdentifiersIn(source): string[]`, sharing the fence/inline-code scanner with
`linkTicketIdentifiers` (extracted to one private segment walker) so there is still exactly one
pattern and code spans/fences stay literal.

Why the view model: it is pure data, golden-testable in `dispatch.test.tsx`, rebuilds identically on
reload (the dispatch-labels "survive a reload" requirement), and both the strip and the bottom-row
rule read from the same computation. Alternative — a `useMemo` in `ChatPage` — rejected because the
bottom-row rule lives in `chatEntries` and would otherwise need the reference set threaded back into
it.

### D2. Render through `renderAfterTrace`, so scope is automatic

`ChatPage` keeps using the `renderAfterTrace` render prop: it renders a `V2TicketStrip` from
`entry.references` instead of the current inline dispatch row. `ChatConversation` needs no new prop.
`PlanTab` passes no `renderAfterTrace`, so the planner chat is untouched; `V2ChatsScreen` renders
`V2ChatPage`, so every global-chats pane gets the strip for free.

### D3. Chip composition and live status

`V2TicketStrip` reuses the `V2DispatchChip` recipe (the `.v2-tag` row, status glyph, project colour
on the identifier) with:

- identifier = `ticket.identifier`;
- acting name = `worker?.name ?? ticket.title` — a worker's name already carries its role ("Platform
  Engineer #552"), and the ticket title stands in before a worker exists, exactly as the current
  dispatch chip and the ticket's own wording;
- status = `dispatchStatus(ticket, worker)` — the worker while it is live, the ticket once it is not.

No roles query is added: the ticket's own description says the title before a worker exists, and the
worker's name carries the role once one does.

Liveness is by construction: `useTickets`/`useWorkers` are invalidated on `ticket.*`/`worker.*`
events, so a status change re-renders the chip without a reload, a poll or a second connection. Keys
are `ticket.id`, so a status change patches the existing chip rather than remounting it.

### D4. A chip opens its ticket through the one shared handler

`renderAfterTrace` builds `onClick={() => openTicket(ticket.identifier)}` with `openTicket` from
`useTicketLink()`, the same handler `MessageBody` uses. The old branch that opened the worker page for
a dispatch is dropped, and the conductor-chat dispatch-labels delta restates the "way in" as the
ticket. This is the ticket's explicit requirement ("same handler; do not write a second one"); the
worker remains reachable from the ticket modal and the Work board.

### D5. Cap at six, expand in place

`V2TicketStrip` owns one local `useState` boolean. With more than six references it renders the first
six and a `+N more` chip; activating it reveals the rest in the same row and flips to showing all. No
persistence, no query — the expansion is view-only, as the ticket asks ("expands the rest in place").

### D6. Follow and layout are already handled by the message block

The strip renders only when `references.length > 0`, so a message with no tickets reserves no height.
The chips are a fixed-height wrapped row inside the existing per-message flex column, so a status
change does not change layout. `useStickToBottom` scrolls only while `following.current` is true (the
reader is at the bottom); a chip appearing or changing while they are scrolled up sets the unread
marker and does not move them. That is the existing behaviour of the follow and satisfies the
"must not pull a reader back" requirement; no change to `stickToBottom.ts` is needed.

### D7. Resolution window

References resolve against the same `useTickets({ limit: 200, includeTerminal: true, fields: 'label' })`
list the chat already loads for dispatches and decisions. An identifier outside that window is
treated as unresolvable and skipped, exactly like one that never existed. Fetching arbitrary older
tickets per identifier is out of scope: it would add per-message requests and a second resolution
path, against the ticket's "no new polling or connection" constraint. Recorded as a risk below.

## Risks / Trade-offs

- [`UTF-8`-style false positives match the identifier pattern] → Pre-existing in the weaver chat's
  inline tags; this change neither widens nor narrows the pattern.
- [A referenced ticket older than the 200-ticket window is silently skipped (D7)] → Documented and
  accepted; the conversation's references are overwhelmingly recent. A follow-up could raise the
  window or resolve lazily if it bites.
- [Dropping "a dispatch chip opens the worker" is a behaviour change] → Intended by the ticket; the
  spec delta records it, and the worker stays reachable from the ticket modal and the Work board.
- [A ticket-status change while the reader is scrolled up now marks the thread unread] → The follow
  only scrolls at the bottom, so the reader is never moved; the unread marker is the same behaviour a
  dispatch chip already has.
- [Strip chips appear after the tickets query resolves, which could nudge layout] → The tickets query
  loads alongside the thread the chat renders from, so the first paint already has it; a later
  refetch only changes chip contents, not presence.

## Migration Plan

Frontend-only. Ships with the normal UI build (`pnpm --filter @weave-ai/ui build`); no daemon restart,
no migration, no API change. Rollback is reverting the commit.

## Open Questions

None that change the specs, the approach or the task breakdown.
