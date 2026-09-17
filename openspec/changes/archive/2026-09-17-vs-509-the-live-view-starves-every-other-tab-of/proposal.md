## Why

The current V2 global Live page mounts `FanInStreams`, which opens one long-lived SSE connection for every listed workspace. The daemon's public listener is plain Node HTTP/1.1 (or HTTPS without HTTP/2), so six workspace streams can consume the browser's per-origin connection pool and leave ordinary requests in a second or third tab queued indefinitely. VS-417 already deduplicates consumers within one workspace, but it cannot multiplex different workspaces or different documents.

The fix must keep every global Live card live while making the global page's connection count independent of workspace count. The stream must resume from per-workspace cursors so a reconnect does not make a card stale, and ordinary workspace-scoped pages must keep their existing stream behavior.

## What Changes

- Add a daemon-level authenticated SSE endpoint that multiplexes the loaded workspaces' durable and ephemeral events onto one connection, with a per-workspace replay cursor.
- Add a client global event-stream registry/state machine that consumes that endpoint, routes events by `workspaceId`, preserves connection status and reconnect behavior, and shares one source among global pages and global Live feeds in a document.
- Make global `FanInStreams` acquire the multiplexed source once instead of opening one source per workspace; make global Live worker feeds consume that source while retaining their workspace filtering.
- Preserve the existing one-stream-per-workspace behavior for workspace-scoped pages and the existing hidden-document pause/resume contract.
- Add server and UI regression coverage for connection count, replay after reconnect, cross-workspace event routing, and two/three-document REST requests while global Live is open.

## Capabilities

### New Capabilities

- `global-event-stream`: authenticated daemon-wide SSE multiplexing and per-workspace replay semantics.

### Modified Capabilities

- `live-streams/connection-state`: global surfaces use one multiplexed persistent stream and still expose the existing connection/reconnect/hidden states.
- `web-v2/live`: global Live keeps all workspace cards live through the multiplexed source without opening one connection per workspace.

## Impact

- `packages/server/src/app.ts`, a new daemon-level event route, route table/OpenAPI documentation, and server tests.
- `packages/ui/src/api/events.ts`, `packages/ui/src/api/streams.ts`, `packages/ui/src/api/context.tsx`, `packages/ui/src/api/runStream.ts`, `packages/ui/src/v2/WorkerFeed.tsx`, and global Live wiring/tests.
- No database migration and no breaking change to `/api/w/:ws/events`; the new endpoint is additive and carries the existing `WorkspaceEvent` payload shape.
