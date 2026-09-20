## Context

See proposal.md — Why. Relevant current state:

- `MessageBody` (`packages/ui/src/v2/ChatMessage.tsx`) owns the only ticket-identifier rewrite: a
  module-local `IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g` applied to the raw markdown body before
  `Markdown` renders it, producing `[ID](#ticket:ID)` anchors; a delegated `onClick` on the wrapper
  calls `onTicket`. `.ac-prose a[href^='#ticket:']` in `index.css` paints the bordered mono tag.
- Because the rewrite runs on the raw source, an identifier inside a backtick has its markdown
  syntax emitted inside the code span: `` `VS-623` `` renders literally as
  ``[VS-623](#ticket:VS-623)``. Code is not currently protected.
- The session chat (`WorkerPage.SessionThreadFeed` → `SessionTurn`) renders each turn through
  `components/Transcript.tsx` (prose as `Markdown`) plus `components/LiveActivity.tsx`
  (`LivePartials` for streaming text), and a delivered-final-text fallback as `Markdown`. None of
  these receive `onTicket`; `SessionThreadFeed` has no ticket linkifier at all.
- `Transcript` and `RunTranscript` are shared: session turns, the worker live view (`WorkerFeed`),
  the run page (`RunPage`), the ticket activity feed (`Ticket.tsx`) and the chat trace
  (`ChatTrace` narration) all render text through them.
- The weaver/planner chat (`ChatConversation`) passes `onTicket` to `ChatMessage`, but not to its
  live section (`LiveTurnSection`) or trace (`ChatTrace`).
- Each chat builds its own `openTicket` with `useGo` (`ChatPage.tsx:532`, `PlanTab.tsx:127`).
- The modal primitive already exists: `Sheet` (`components/Sheet.tsx`) is a centred `role="dialog"`,
  `aria-modal`, focus-trapped, portal overlay with Esc/backdrop/close dismissal and its own scroll
  container.
- The ticket page's pieces are `useTicket`, its header live line (`LiveActivityLine` +
  `useWorkerActivity`), and `ActivityPane`/`RunTurn`/`RunTranscript` for the feed, but `ActivityPane`
  and `RunTurn` are module-private to `v2/ticket/Ticket.tsx`.
- The ticket route already renders `ErrorState code="TICKET_NOT_FOUND"` ("No ticket X in this
  workspace.") with a Back to Work action (`v2/ticket/Ticket.tsx:123`).

## Goals / Non-Goals

**Goals:**

- One identifier pattern, one tag recipe, one click handler reused by every agent-text surface.
- Identifier tags in the session's settled transcript prose/thinking, live streaming text, and
  delivered-final-text fallback; and in the weaver/planner live stream and trace.
- On desktop, a click opens a ticket modal over the chat, with a top button to the full page; on
  phone, navigation.
- Code spans, fences, diffs, written-file previews and command output stay literal.
- An unknown identifier shows not-found in the modal, added nowhere new.

**Non-Goals:**

- No second regex, tag recipe, markdown parser, or second ticket view.
- No change to a worker's or the weaver's delivery rules; display only.
- Not turning the terminal UI/CLI into ticket browsers.
- Not opening the modal over the ticket page itself (its own feed navigates directly).
- Not linking identifiers in the session feed's human-authored messages (the ticket scopes this to
  agent text; reported as a deliberate gap).
- No API, database or dependency change.

## Decisions

### D1. One shared linkifier in `lib`, with code protection

Add `packages/ui/src/lib/ticketLinks.ts`:

- `TICKET_IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g` — the single pattern, moved here.
- `linkTicketIdentifiers(source: string): string` — walks the source line by line, tracking fenced
  code state (```` ``` ````), and in non-fence lines splits each line on inline code spans
  (`` `…` ``); only the segments outside code are matched and rewritten to
  `[ID](#ticket:ID)`. The fence/code text is re-emitted untouched.

This is a pre-pass on markdown source, so it composes with the existing renderer and needs no second
markdown implementation. Protecting code spans in the pre-pass is what stops the identifier from
being wrapped inside a code span (today's bug).

Why not do the rewrite inside `markdown.ts`'s `inline()`? That would run it on every markdown
surface (knowledge files, briefs, plan prose) with no navigation handler. The pre-pass only runs
where a surface asks for it.

Alternative considered: a full markdown AST pass. Rejected — the renderer is deliberately a small
hand-rolled subset; adding a library is the cost VS-349 avoided.

### D2. `Markdown` owns the tag and the click

`Markdown` gains `onTicket?: (id: string) => void`. When present: transform the source with
`linkTicketIdentifiers`, and the wrapper's delegated `onClick` first honours an
`a[href^="#ticket:"]` target (calling `onTicket`, preventing default), then falls through to the
existing copy handler. When absent, `Markdown` behaves exactly as today. `MessageBody` drops its
private regex and renders `<Markdown onTicket={onTicket} … />`; the observable fix is that an
identifier inside code stays a code span instead of showing rewritten markdown.

### D3. Thread an optional `onTicket` through the shared text components

- `components/Transcript.tsx`: `Transcript`/`TranscriptLine` accept `onTicket?` for the prose and
  thinking `Markdown` only; `DiffBlock`, `EditPayloadBody` and command rows stay verbatim.
- `components/LiveActivity.tsx`: `LivePartials` passes `onTicket?` to the streaming text `Markdown`
  (thinking and tool-output partials are plain text).
- `v2/LiveTurnSection.tsx` and `v2/ChatTrace.tsx`: accept `onTicket?` and thread it to
  `LivePartials` and to the trace narration `Markdown` (`TraceLine`), so the weaver/planner live
  stream and trace link. `ChatTurnTrace` passes it through.
- `v2/SessionTurn.tsx`: passes `onTicket?` to `Transcript`, `LivePartials` and the
  delivered-final-text fallback `Markdown`.
- `components/RunTranscript.tsx` and `v2/WorkerFeed.tsx`: pass `onTicket?` to `Transcript`/`LivePartials`.
- `v2/ChatConversation.tsx`: passes its `onTicket` to `LiveTurnSection` and `ChatTurnTrace`.

Every prop is optional, so a caller without a handler keeps compiling and renders literal
identifiers — no implicit broken link.

### D4. One shared link handler, provided once

New `packages/ui/src/v2/ticket/TicketModal.tsx`:

- `TicketModalProvider` holds `{ identifier | null }`, exposes `openTicket(id)`, and renders one
  `<TicketModal>` while open. Mounted in `V2Workspace` (`v2/V2Root.tsx`), so it is workspace-scoped
  and survives navigation between chat, plan and session pages.
- `useTicketLink(): (id: string) => void` returns the provider's `openTicket`, falling back to
  `go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: id } })` when there is no provider (tests
  and any non-workspace surface). The fallback keeps every existing test and stray usage working.
- `ChatPage`, `PlanTab` and `WorkerPage` replace their local `openTicket` with `useTicketLink()`, so
  the weaver, planning and session chats share one click behaviour. The `onTicket` prop plumbing
  downstream is unchanged.
- `v2/ticket/Ticket.tsx`'s own activity feed keeps direct `useGo` navigation: opening a modal over
  the page already showing that ticket would be redundant.

### D5. The modal reuses the ticket page's components

`TicketModal` is built only from existing pieces:

| Concern | Reused |
|---|---|
| Modal shell, focus trap, Esc/backdrop/close, scroll | `Sheet` (`components/Sheet.tsx`) |
| Ticket detail query | `useTicket(identifier)` |
| Header identity, status | `StatusGlyph`/`StatusBadge`, `Button` |
| Live activity line | `LiveActivityLine` + `useWorkerActivity` + `mergeWorkerActivity`/`activityLine` |
| Live feed / turn transcripts | `RunTranscript` (via the extracted `RunTurn`) |
| Comments + turns feed | a `TicketActivityFeed` extracted from `ActivityPane`'s `feed`, shared with the ticket page |
| Not-found | `ErrorState code="TICKET_NOT_FOUND"` |
| Top button / navigation | `useGo` to the full ticket route, then close |

To share the feed without a second view, `ActivityPane`'s comment/turn assembly (`feed`) and `RunTurn`
are extracted from `v2/ticket/Ticket.tsx` into an exported `TicketActivityFeed` module used by both
`ActivityPane` and the modal. `Sheet`'s `title`/header area carries the small **Open ticket** button
as well as the close control.

### D6. Desktop modal, phone navigation

`useTicketLink` chooses by viewport width: at `md` (≥768px) the modal opens; below it the handler
navigates to the ticket page as today. Why: the modal's value is inspecting a ticket beside a wide
chat, on top of the chat's live feed, without losing place; on a phone the chat already owns the full
viewport and a single-page scroll plus the composer, so a bottom sheet would stack a second scroll
region over the draft, while the ticket page gives the feed the whole screen. This follows captain's
"keep today's behavior unless the modal works well there". The width is read from a media-query
listener, not measured container width, because the handler is shared and not tied to a chat's own
DOM node.

### D7. Audit result (who links, who does not)

| Surface | Renders text via | Links after this change |
|---|---|---|
| Weaver chat message bodies | `MessageBody`/`Markdown` | Yes (tag); code spans now literal |
| Weaver/planner live stream + trace narration | `LiveTurnSection`/`ChatTrace` | Yes (new; required so the modal is reachable there) |
| Planner chat conversation | `ChatConversation` | Yes (same components as weaver) |
| Session settled transcript (prose, thinking) | `Transcript`/`Markdown` | Yes (new) |
| Session live streaming text | `LivePartials`/`Markdown` | Yes (new) |
| Session delivered-final-text fallback | `Markdown` | Yes (new) |
| Worker live view / decision feed | `WorkerFeed`→`RunTranscript`→`Transcript` | Yes |
| Run transcript page | `RunPage`→`RunTranscript`→`Transcript` | Yes |
| Ticket activity feed | `Ticket.tsx`→`RunTranscript`→`Transcript` | Yes, direct navigation (no modal over itself) |
| Diff, written-file preview, command output | `DiffBlock`/`WrittenFile`/`<pre>` | Intentionally literal |
| Session feed human messages | raw `Markdown` in `SessionThreadFeed` | No — deliberately out of scope, reported |
| Terminal UI / CLI | Ink / text | Not applicable |

## Risks / Trade-offs

- [Regex false positives: strings like `UTF-8` match `[A-Z]+-\d+`] → Pre-existing weaver-chat
  behaviour; this change neither widens nor narrows the pattern.
- [Wrapping a `<a>` inside generated `<a>` when an identifier sits in link text] → The pre-pass runs
  before markdown link conversion, exactly as `MessageBody` does today; no new nesting.
- [A modal needs ticket data the chat has not loaded] → `useTicket(identifier)` issues its own query;
  the query cache is shared with the ticket page, so a second open is a cache hit.
- [Threading a prop through many files] → Every prop is optional and the default path is today's
  behaviour; the tests cover the literal cases and the no-provider fallback.
- [Modal over a chat that is itself single-page-scrolled] → `Sheet` is a portal with its own scroll
  container and locks body scroll while open; on close the chat is untouched (it was never
  unmounted), so scroll and draft persist. Proven by a test and the rendered evidence.
- [Phone decision could be wrong] → Chosen to keep today's navigation; the spec records the reason
  so it can be revisited.

## Migration Plan

Frontend-only; ships with the normal UI build. No rollback beyond reverting the commit. The daemon
needs no restart (static UI rebuild).

## Open Questions

None that change the specs or task breakdown.
