## Why

A persistent session's chat shows agent text as the turn's own transcript (VS-618), but ticket
identifiers in that text are plain text: captain filed a ticket from a session and could not click
`ACME-113` to open it. The weaver chat has linked identifiers since VS-349, but VS-618's transcript
text, the live streaming turn and the delivered-final-text fallback do not go through that linkifier.

Captain's addition (ticket comment 2026-09-20 04:20Z): clicking a ticket link should not navigate
away from the chat. It should open the ticket in a modal over the chat, with a small button at the
top to open the full ticket page, so a ticket can be inspected — live feed and all — without leaving
the conversation, in the weaver, planning and session chats alike.

## What Changes

- **One shared identifier linkifier.** The ticket-identifier rewrite currently lives inline in
  `MessageBody` as a single regex (`IDENTIFIER`). Extract it into one shared helper and use it
  everywhere agent text is rendered, so there is still exactly one pattern and one tag recipe.
- **Identifiers link in every agent-text surface.** The session's settled transcript (prose and
  thinking), live streaming turn and delivered-final-text fallback, the weaver/planner live stream
  and trace narration, and the shared `Transcript` prose all render a ticket identifier as the same
  bordered mono tag.
- **Clicking a tag opens a ticket modal over the chat, on desktop.** One shared link handler
  (`useTicketLink`, provided once at the workspace shell) is used by the weaver chat, the planning
  chat and the session chat. On desktop it opens a modal showing the ticket's live feed and a small
  **Open ticket** button at the top that goes to the full ticket page. On phone it keeps today's
  behaviour and navigates to the ticket page — stated with its reason in the design.
- **The modal reuses the ticket page's own components, it is not a second view.** `Sheet` as the
  modal primitive, `useTicket` for the ticket detail, the ticket activity feed and `RunTranscript`
  for the live feed, `LiveActivityLine` (`useWorkerActivity`) for the live line, and `ErrorState`
  for not-found. Names are listed in the design and the spec.
- **Closing does not disturb the chat.** Esc, the close button and the backdrop close the modal; the
  chat underneath keeps its scroll position and any composer draft, because the modal is a portal
  overlay and never unmounts the chat.
- **An unknown identifier is not a broken modal.** The modal renders the existing not-found state
  ("No ticket X in this workspace.") with a way out.
- **Literals stay literal.** An identifier inside an inline code span, a fenced code block, a diff,
  a written-file preview or command output MUST NOT become a tag.
- Display only. No delivery rule, API, database or dependency change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: a session's transcript text, live streaming text and delivered final-text
  fallback render ticket identifiers as clickable tags; identifiers inside code stay literal;
  activating a tag follows the shared chat behaviour (modal on desktop, navigation on phone).
- `web-v2/chat`: the inline-reference requirement is strengthened — one shared linkifier on every
  agent-text surface including the live stream and trace, and code literals stay literal — and a new
  requirement defines the ticket modal over the chat (reused components, top button, close paths,
  page state intact, not-found, phone navigation, one shared handler).
- `interface-live-progress`: a session's live streaming text renders ticket identifiers as clickable
  tags, matching the finished transcript and the weaver/planner live stream.

## Impact

- `packages/ui/src/lib/` — one new helper module for the identifier linkify (with code-span/fence
  handling), replacing the inline regex in `ChatMessage.tsx`.
- `packages/ui/src/components/Markdown.tsx` — optional `onTicket` so the one markdown renderer can
  emit and handle the tags.
- New `packages/ui/src/v2/ticket/TicketModal.tsx` — the modal, the `TicketModalProvider` and the
  `useTicketLink` hook; mounted in `V2Workspace`.
- `packages/ui/src/v2/ChatMessage.tsx` (`MessageBody`), `components/Transcript.tsx`,
  `components/LiveActivity.tsx` (`LivePartials`), `v2/SessionTurn.tsx`, `v2/LiveTurnSection.tsx`,
  `v2/ChatTrace.tsx`, `v2/ChatConversation.tsx`, `v2/ChatPage.tsx`, `v2/PlanTab.tsx`,
  `v2/WorkerPage.tsx` — thread `onTicket` and switch their local `openTicket` to `useTicketLink`.
- `packages/ui/src/components/RunTranscript.tsx`, `v2/WorkerFeed.tsx`, `v2/RunPage.tsx`,
  `v2/LivePage.tsx`, `v2/ticket/Ticket.tsx` — thread `onTicket` into the shared transcript (the
  ticket page's own feed navigates directly, not into a modal over itself).
- `packages/ui/src/v2/V2Root.tsx` — mount `TicketModalProvider` in `V2Workspace`.
- Tests: `packages/ui/src/test/` (linkifier, modal open/close/not-found, code-span literal, session
  transcript/live links) and the existing `v2chat.test.tsx`, `v2worker.test.tsx`.
- No `docs/API.md`, no migration, no dependency.
