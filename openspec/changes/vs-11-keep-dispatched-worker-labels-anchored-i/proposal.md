## Why

When the conductor files work and a worker picks it up, the web chat shows it as a row of worker chips (`packages/ui/src/routes/Chat.tsx`, the block labelled `live worker chips`). That row is rendered from `useWorkers({ status: 'running' })` and sits between the thread and the composer, so it is pinned to the bottom of the conversation: it slides away from the conductor message that announced the work as soon as the human types again, and it vanishes entirely the moment the worker stops running. The chat therefore carries no record of what was dispatched or how it ended — the workspace owner has to open the board to find out, and the transcript reads as if nothing happened.

Everything needed to place and keep those labels is already durable except one link. `thread_messages.run_id` records which conductor run produced each outbound message, agent rows survive retirement, and tickets carry their full status history — but nothing records which conductor run filed a ticket, so a label cannot be attached to the message that triggered it.

## What Changes

- Tickets record the run that created them. A new nullable `tickets.created_run_id` is written from the acting run at creation time, so a ticket the conductor filed during a turn can be traced back to that turn. A ticket created by a human carries `null` and is never labelled in the chat.
- The conductor chat renders a **dispatch label** as an ordinary item in the message list, directly after the conductor message whose run filed the ticket, instead of as a pinned row above the composer. Later messages push it up with the rest of the history; it never moves to the bottom again.
- The label persists for the life of the thread. While the work runs it shows a working state; when the work ends it stays where it is and shows the outcome — done for a finished ticket, failed for a cancelled one or a worker in error, and the ticket's own state (blocked, needs you, merging) in between. It is the truthful current state of that dispatch, not a transient presence indicator.
- Several tickets filed in one turn produce several labels under that message, ordered by the order they were filed.
- Because the labels are built from persisted rows only — the ticket, its `created_run_id`, the anchoring message's `run_id` and the worker's row — a page reload reproduces the same labels in the same positions with the same states.
- Dispatches that cannot be attributed to a message in the open thread (a worker the human started from the board, a ticket filed before this change, a turn that filed work without replying) keep today's behavior: they render in the existing row below the thread. Nothing that is visible now disappears.
- The chat's ticket query stops excluding terminal tickets and its worker query stops excluding retired workers, since a finished dispatch is exactly the case the labels must keep showing.

## Capabilities

### New Capabilities
- `conductor-chat/dispatch-labels`: what the conductor chat shows for work the conductor dispatched — where a label is anchored, how it survives later messages and a reload, and how it reports the dispatch's outcome once the work ends.

### Modified Capabilities

(None. `openspec/specs/` holds no capabilities yet, so the ticket-provenance field this depends on is specified inside the new capability as the record the chat reads.)

## Impact

- `packages/db/src/migrations/` — one additive migration adding the nullable `tickets.created_run_id` column.
- `packages/shared/src/types.ts` — `Ticket` gains `createdRunId: string | null`, alongside the `checkoutRunId` / `executionRunId` fields it already carries.
- `packages/core/src/tickets/service.ts` — `create` persists the acting run id.
- `packages/ui/src/routes/Chat.tsx` — dispatch labels rendered inside the message list; the pinned chip row demoted to the unattributed fallback; ticket and worker queries widened to include terminal tickets and retired workers.
- `packages/ui/src/api/hooks.ts` — `TicketQuery` gains the already-supported `includeTerminal` flag.
- `packages/ui/src/components/` — a dispatch label component, built on the existing `StatusGlyph` vocabulary.
- `packages/ui/src/test/factories.ts` — the ticket factory gains the new field.
- No change to the run engine, the wake queue, the supervisor, the worker spawn path, the event bus or any HTTP route. `GET /tickets?includeTerminal=true` and `GET /workers?includeRetired=true` are consumed exactly as they already exist.
- Tests: core coverage that a ticket created by an agent run records that run and one created by a human does not; UI component tests for anchoring, position after a later message, the working-to-outcome transition, reload, multiple dispatches from one message, and the unattributed fallback.

## Out of scope

- The live turn stream (VS-9). Dispatch labels sit in the durable message list; the live transcript stays transient and below it. The two are rendered independently and neither reads the other's state.
- The terminal chat (`packages/tui/src/apps/Chat.tsx`) and the Telegram channel. The ticket names the web app's conductor chat.
- Any redesign of the chat beyond the dispatch labels themselves.
- Backfilling `created_run_id` for tickets that already exist. Their labels fall into the unattributed fallback, which is exactly today's behavior.
