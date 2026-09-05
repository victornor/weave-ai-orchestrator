## Why

The conductor chat renders nothing between "message sent" and "reply arrives". A turn routinely runs for minutes while the conductor reads the briefing, files tickets and answers decisions, and the human sees a static screen with no evidence the conductor is alive or how far along it is. The daemon already captures everything needed — the run engine persists a normalized `RunEvent` per assistant text block and per tool call, and `GET /api/w/:ws/runs/:id/events/stream` already replays and tails them — but no chat surface subscribes to it. `conductor attach conductor` proves the pipe works end to end; the chat is simply not wired to it.

Two pieces of dead code stand in for the missing behavior today and mislead readers: `ChatRoute` keeps a `streaming` state fed by `thread.message` frames carrying `partial: true`, and nothing in the daemon has ever emitted a partial thread message.

## What Changes

- The conductor chat (web `ChatRoute` and the Ink `Chat` app behind `conductor chat`) shows an explicit working indicator for the conductor's turn, driven by the run's real lifecycle rather than an optimistic local flag.
- While a conductor turn runs, both chats subscribe to that run's event stream and render a live transcript beneath the thread: assistant text as it is produced, and each tool call as a compact, collapsible block with its name, target and result — visually secondary to the text.
- The live transcript is derived from the run's own events, so a page reload mid-turn replays the persisted events and resumes tailing instead of showing an empty chat.
- The final reply keeps arriving as it does today, as an outbound `thread.message` from `ac_human_send`. The live transcript is transient: it is cleared when the run finishes and never re-renders text the thread already shows, so the reply appears exactly once. `ac_human_send` events are dropped from the chat's transcript for the same reason, via one predicate exported from `@agent-conductor/shared` so both surfaces agree.
- The web transcript builder (`packages/ui/src/lib/transcript.ts`) is corrected to correlate `tool.result` with its `tool.call` on the identifier the runtime adapters actually emit (`id`/`toolUseId`, not only `callId`) and to carry the result content into the block. Today the correlation never matches, so every tool renders as a permanently pending call with no result — the chat cannot meet "a compact view of its arguments and result" without this. `@agent-conductor/render`, which the TUI uses, already does both.
- `GET /api/w/:ws/conductor` returns a detail envelope (`{ worker, ticket, lastRun, usage }`) instead of a bare agent, matching `GET /workers/:id`, so a client can discover the conductor's current run in one request. **BREAKING** for consumers that read agent fields off the response root: the web's `useConductor` already accepts the envelope, the TUI `attach` app does not and is fixed here.
- The dead `partial`-message streaming path in `ChatRoute` is removed, replaced by the live transcript.

## Capabilities

### New Capabilities
- `conductor-chat/live-turn-stream`: what the conductor chat shows while a turn is running — the working state, incremental assistant text, per-tool-call blocks, non-duplication of the final reply, and resumption after a reload.

### Modified Capabilities

(None. `openspec/specs/` has no capabilities yet, so the API-shape change to `GET /conductor` is specified inside the new capability as the discovery contract the chat depends on.)

## Impact

- `packages/server/src/routes/workers.ts` — `conductorRoutes()` returns a detail envelope with `lastRun`.
- `packages/ui/src/routes/Chat.tsx` — live transcript, working state, removal of the `partial` path.
- `packages/ui/src/api/` — a per-run SSE hook (`useRunEventStream`) plus the running-run selector the chat needs; `useConductor` unchanged in shape.
- `packages/ui/src/lib/transcript.ts` — tool call/result correlation fix and result detail.
- `packages/shared/src/` — the `ac_human_send` suppression predicate, shared by both surfaces.
- `packages/tui/src/apps/Chat.tsx` — the same live transcript, reusing `TranscriptView` and `runEventsToTranscript` from `@agent-conductor/render`, following the existing `Attach` app.
- No change to the run engine, the runtime adapters, the workspace event bus, or the database schema. `GET /runs/:id/events` and `/runs/:id/events/stream` are consumed as they already exist.
- Tests: a server route test for the conductor envelope, UI component tests for the chat's live transcript and its non-duplication rule, and a unit test for the corrected tool correlation.

## Out of scope

- Worker ticket chat views (the ticket says so). `WorkerPage` keeps its own live-transcript listener on the never-emitted `run.event` workspace event, which is dead today and stays dead after this change; it is a separate defect worth its own ticket.
- Any change to the run engine, the `run.event` workspace event, or the Telegram channel.
- Redesigning the chat layout beyond adding the transcript region.
