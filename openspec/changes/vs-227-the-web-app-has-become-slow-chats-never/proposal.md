## Why

Captain’s `/chats` panes never show history and a send stays on “Sending…”, even though the message is stored and the conductor is woken. Measured against the live fern-services workspace on 2026-09-11: the chats-page REST calls themselves finish in milliseconds. The hang is the browser not receiving those responses — HTTP/1.1’s ~6 connections per origin are held by SSE from this tab and any other tab, so `GET /threads`, `GET /messages`, and `POST /messages` queue forever.

## What Changes

- Persistent SSE SHALL pause while the document is hidden, and the app SHALL keep enough origin connections free that ordinary REST (thread list, messages, send) can complete while any number of workspaces and live workers exist.
- A conductor-chat send SHALL settle in bounded time. HTTP 201 SHALL clear the composer even when workspace/run streams are down. `sending` SHALL NOT wait solely on `run.finished`.
- `/chats` SHALL show a pane’s history as soon as that pane’s messages request completes, without waiting on SSE. Overloaded list fetches the chat uses for labels (full terminal tickets, retired workers) SHALL NOT occupy connections ahead of threads/messages, and SHALL NOT download whole ticket descriptions for chip lookup.
- **Not in this ticket:** `run_events` retention. Live measurement: 276,940 rows, ~225 MB, ~186 MB of `payload_json`. Chat SQL that touches them (`runs.traces` for 200 conductor runs) is 3.2 ms / 7,899 events. Growth is real and should be its own change; it is not why panes stay empty today.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `live-streams/connection-state`: a live stream pauses when its document is hidden and resumes when visible; across the origin, persistent streams must not starve REST.
- `conductor-chat/global-chats`: a pane populates from REST once messages arrive; SSE is not a gate; `/chats` still holds at most one live workspace subscription of its own.
- `conductor-chat/composer-send-lifecycle`: a send settles (success, failure, or timeout) in bounded time; 201 clears the composer even if streams are down.
- `conductor-chat/live-turn-stream`: the post-send working indicator is not stuck on the in-flight send label when the POST has already succeeded.

## Impact

- `packages/ui` — `EventStream` / `useLiveStream` visibility gating; `/chats` query order and ticket/worker fetch shape; `Chat.tsx` `send()` / `sending`; `api/client.ts` bounded fetch timeout for mutating (and hanging) calls.
- `packages/server` — HTTP/1.1 listener unchanged unless apply proves HTTP/2 is required; no schema change expected.
- `packages/core` — optional lean ticket list for chat labels; no `run_events` purge.
- Tests: connection-budget with a fake EventSource cap; send timeout; `/chats` messages render without tickets having returned.
- Out of scope: retention/purge of `run_events` or `events`; changing VS-199’s one-live-pane rule on `/chats` itself.
