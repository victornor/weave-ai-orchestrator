## 1. Shared identifier linkifier

- [x] 1.1 Create `packages/ui/src/lib/ticketLinks.ts` with the one `TICKET_IDENTIFIER` pattern and `linkTicketIdentifiers(source)`, rewriting identifiers to `[ID](#ticket:ID)` outside inline code spans and fenced code blocks; add `packages/ui/src/test/ticketLinks.test.ts` covering prose, a code span, a fence and a mixed line. Verify `pnpm --filter @weave-ai/ui test -- ticketLinks`.
- [x] 1.2 Add `onTicket?: (id: string) => void` to `packages/ui/src/components/Markdown.tsx`: transform with `linkTicketIdentifiers` and handle `a[href^="#ticket:"]` clicks before the copy handler when present, unchanged when absent. Verify with 1.1 and the existing Markdown tests.

## 2. MessageBody uses the shared linkifier

- [x] 2.1 Remove the module-local `IDENTIFIER` rewrite from `packages/ui/src/v2/ChatMessage.tsx`; render `<Markdown onTicket={onTicket} …>` in `MessageBody`. Verify `v2chat.test.tsx` keeps passing and an identifier inside a code span stays a literal `<code>` with no rewritten markdown text. Verify `pnpm --filter @weave-ai/ui test -- v2chat`.

## 3. Thread onTicket through the shared text surfaces

- [x] 3.1 Add optional `onTicket` to `packages/ui/src/components/Transcript.tsx` (`Transcript` and `TranscriptLine`), passing it only to the prose and thinking `Markdown`; leave `DiffBlock`, `EditPayloadBody` and command rows untouched. Add optional `onTicket` to `LivePartials` in `packages/ui/src/components/LiveActivity.tsx`, passing it only to the streaming text `Markdown`.
- [x] 3.2 Add optional `onTicket` to `packages/ui/src/v2/SessionTurn.tsx` (to `Transcript`, `LivePartials`, and the delivered-final-text fallback `Markdown`), to `packages/ui/src/v2/LiveTurnSection.tsx` (to `LivePartials` and `ChatTrace`), and to `packages/ui/src/v2/ChatTrace.tsx` (`TraceLine` narration and `ChatTurnTrace`). Pass `onTicket` from `packages/ui/src/v2/ChatConversation.tsx` to `LiveTurnSection` and `ChatTurnTrace`.
- [x] 3.3 Add optional `onTicket` to `packages/ui/src/components/RunTranscript.tsx` (to `Transcript` and `LivePartials`) and to `packages/ui/src/v2/WorkerFeed.tsx` (to `RunTranscript`); pass it from `packages/ui/src/v2/RunPage.tsx`, `packages/ui/src/v2/LivePage.tsx` and the `RunTranscript` feed in `packages/ui/src/v2/ticket/Ticket.tsx` using plain `useGo` navigation (no modal over the ticket page itself).

## 4. Session chat wires the handler

- [x] 4.1 In `packages/ui/src/v2/WorkerPage.tsx`, build `onTicket` in `SessionThreadFeed` from `useTicketLink()` and pass it to `SessionTurn`; pass it to `WorkerFeed` from `WorkerBody` as well.

## 5. Shared link handler and ticket modal

- [x] 5.1 Extract the ticket activity feed from `packages/ui/src/v2/ticket/Ticket.tsx` into an exported `TicketActivityFeed` (with `RunTurn`) used by both `ActivityPane` and the modal, so there is one feed view. Verify the ticket page tests still pass.
- [x] 5.2 Create `packages/ui/src/v2/ticket/TicketModal.tsx`: `TicketModal` built from `Sheet`, `useTicket`, `LiveActivityLine`/`useWorkerActivity`, `TicketActivityFeed`, `StatusGlyph`, `Button` and `ErrorState` (`TICKET_NOT_FOUND`) — with a top "Open ticket" control (via `useGo`, then close), Esc/close/backdrop dismissal, and no unmount of the chat behind it; plus `TicketModalProvider` and `useTicketLink()` returning the provider's `openTicket`, falling back to `go` navigation when no provider (phone width also navigates).
- [x] 5.3 Mount `TicketModalProvider` in `V2Workspace` (`packages/ui/src/v2/V2Root.tsx`); switch `packages/ui/src/v2/ChatPage.tsx`, `packages/ui/src/v2/PlanTab.tsx` and `WorkerPage.tsx` from their local `openTicket` to `useTicketLink()`.
- [x] 5.4 Mirror the active `.v2-root` theme onto the `Sheet`/`Drawer` portal (`lib/v2ThemeScope.ts`, shared with `Toast`), so a portalled dialog follows light/dark instead of the document default; verify `packages/ui/src/test/v2ThemeScope.test.tsx`.

## 6. Tests

- [x] 6.1 `packages/ui/src/test/v2worker.test.tsx`: a settled-transcript identifier renders a tag whose click opens the modal (desktop) and calls `useGo` to the full page from the modal's top control; a live streaming identifier is a tag; a code-span identifier is a literal `<code>`. Verify `pnpm --filter @weave-ai/ui test -- v2worker`.
- [x] 6.2 A modal test (`packages/ui/src/test/ticketModal.test.tsx` or in `v2chat.test.tsx`): click opens the modal over the chat, Escape closes it, the top control navigates to `/w/$ws/tickets/$ticketId`, and an unknown id renders the `TICKET_NOT_FOUND` state rather than a broken modal; at phone width the handler navigates instead of opening the modal. Verify `pnpm --filter @weave-ai/ui test -- v2chat ticketModal`.
- [x] 6.3 `packages/ui/src/test/v2chat.test.tsx`: the weaver/planner live streaming text and trace narration render an identifier as a tag, and the chat's draft and scroll survive opening and closing the modal.
- [x] 6.4 The modal follows the app theme: `packages/ui/src/test/v2ThemeScope.test.tsx` proves a portalled `Sheet` mirrors a light `.v2-root` onto its portal (the light-theme modal bug the weaver found).

## 7. Audit and report

- [x] 7.1 Write the audit into the ticket report: the table of agent-text surfaces, which link and which deliberately do not (session human messages; terminal/CLI), naming the files, and confirming every linking chat uses the one shared handler. Verify the report is on the ticket before the merge request.

## 8. Rendered evidence and full checks

- [x] 8.1 Capture rendered evidence: the modal open over a session chat with the live feed showing and the top control visible, in both themes at desktop width; a chat with a ticket id before and after; the phone behaviour at phone width. Save outside `work/` and attach each to the ticket with `weave_ticket_attachment_put`. Verify the approval card shows them.
- [x] 8.2 Run `pnpm lint`, `pnpm typecheck` and one full `pnpm test` with `--maxWorkers=4`; verify green and paste both suite blocks verbatim in the report.
