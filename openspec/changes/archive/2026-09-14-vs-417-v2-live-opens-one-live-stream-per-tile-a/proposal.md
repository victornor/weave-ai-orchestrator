# V2 Live: one shared connection, not one stream per tile

Tracker change for [VS-417](weave://tickets/VS-417). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

With V2 Live open, a second tab cannot load: the daemon serves plain HTTP/1.1 (no HTTP/2 in
`packages/server/src`), browsers allow about six concurrent connections per origin shared by every
tab, and V2 Live holds far more than that.

- `packages/ui/src/v2/LivePage.tsx` renders one `WorkerFeed` per live tile, and every `WorkerFeed`
  calls `useRunEventStream` (`packages/ui/src/api/runStream.ts`), which opens its own `EventSource`.
  Eight tiles are eight connections.
- On a global V2 page the shell's `FanInStreams` (`packages/ui/src/api/context.tsx`) opens one
  workspace events `EventStream` per listed workspace — another two at two workspaces.
- It is the same failure VS-199 fixed for global Chats and VS-227 mitigated with a per-page cap;
  V2 Live reintroduced it, with no cap at all.

## What changes

- **Run events ride the workspace events stream.** `packages/core/src/runs/active.ts`'s
  `emitRunEvent` also broadcasts each `RunEvent` as a live-only `run.event` frame on the workspace
  bus (VS-328's ephemeral path), so `'run.event'` moves from `EVENT_TYPES` to
  `EPHEMERAL_EVENT_TYPES`. Nothing durable is written per event, and a client's replay cursor never
  moves on one.
- **One stream per workspace, refcounted.** A module-level registry (`api/streams.ts`) hands out
  one shared `EventStream` per workspace id; `WorkspaceProvider`, `FanInStreams` and every run
  subscription acquire/release it. Two workspaces on Live are two connections, whatever the tile
  count; a workspace page is one.
- **`useRunEventStream` keeps its shape and changes its transport.** It still returns
  `{ events, status, retryNow }` and merges persisted `GET /runs/:id/events` rows with the live
  tail by `seq`, but the tail now comes from `run.event` frames on the shared workspace stream, not
  a per-run `EventSource`. Every V2 surface that shows a run trace (`WorkerFeed` for Live, Roles and
  the Watch preview; Chat, ticket and run pages) gets the shared mechanism for free.
- **Recovery still works.** The shared `EventStream` keeps VS-100's backoff/online/offline machine
  and pausing on `document.hidden`; a run hook refetches its persisted events when the stream
  reconnects, so a frame missed while dropped is filled from the read behind it.

## Out of scope

HTTP/2 or TLS on the daemon (they do not fix plain-HTTP loopback); Live ordering (VS-415). V1's
own pages are reached through the same `useRunEventStream`, but no V1 layout or cap logic is changed.
