## Context

See `proposal.md` for the observed failure. Today `FanInStreams` acquires one shared `EventStream`
per workspace, and `useRunEventStream` attaches each Live card to that workspace registry. This
removed the old per-card duplication (VS-417), but global pages still grow linearly with the number
of workspaces. Each workspace has its own core `EventBus` and durable sequence, while
`WorkspaceEvent` already carries `workspaceId`; the public Hono app has a daemon-level `/api` route
and an authenticated middleware before it.

## Goals / Non-Goals

**Goals:**

- Give global Live and other global fan-in consumers one authenticated SSE connection per document,
  regardless of workspace count.
- Preserve the existing event payloads, named events, ephemeral semantics, hidden-document behavior,
  reconnect backoff and per-workspace stream behavior.
- Recover durable events with independent workspace cursors and recover missed ephemeral run frames
  through the persisted run read on reconnect.
- Verify both the server's subscription lifecycle and the browser-side two/three-document REST case.

**Non-Goals:**

- Replacing `/api/w/:ws/events` or changing its cursor contract.
- Switching the daemon to HTTP/2, adding a service worker/shared worker, or redesigning browser tab
  coordination. One stream per document leaves ample room for ordinary requests in the reported
  two- and three-tab case without introducing cross-document ownership races.
- Changing the Live roster, card layout, transcript rendering, or workspace-scoped navigation.

## Decisions

### Add a daemon-level multiplexed SSE route

Add `/api/events` beside the existing daemon-level routes. The route receives the loaded workspace
map through `AppDeps`, subscribes to every workspace's `EventBus` before replay, and uses one `Pump`
per response (or an equivalent tagged queue) to merge events. Each emitted frame keeps the existing
named `event` and JSON data. Durable frames carry an opaque id containing the workspace and sequence;
the request's explicit cursor map is authoritative on reconnect.

The cursor map is encoded as a bounded URL-safe JSON query value (for example,
`after=<base64url(JSON)>`). The server parses invalid or oversized values as a fresh tail rather
than throwing from the stream. For each workspace, replay uses `bus.since(cursor, 500)` in batches;
the live queue is filtered by the same per-workspace cursor before sending. Subscription registration
must happen before replay so an event emitted during replay is queued rather than lost. Ephemeral
frames are forwarded without an id and do not update the cursor map.

Alternative considered: a process-global monotonically increasing cursor. Rejected because each
workspace's existing outbox sequence is independent and introducing a second durable ordering source
would require new storage and migration semantics. Alternative considered: HTTP/2. Rejected because
the daemon's normal public listener is plain HTTP/1.1 and TLS is optional.

### Keep separate local and global stream registries

Retain `EventStream` and `acquireWorkspaceStream` for workspace-scoped routes. Add a global stream
implementation with the same public status/retry/visibility contract and a registry with one entry
per document. `FanInStreams` acquires/releases that global entry once; it no longer loops over ids.
The global stream's `onEvent` callbacks receive the unchanged `WorkspaceEvent`, so global query
invalidation can use its workspace id.

Alternative considered: make every workspace `EventStream` proxy a single global source. Rejected:
the proxy would keep the per-workspace registry's lifecycle and status accounting coupled to a source
it does not own, and it would make workspace pages unexpectedly dependent on a global route.

### Explicitly opt Live feeds into the global source

Thread a small global-source option through `WorkerFeed` to `useRunEventStream`. Global Live passes
it for its cards; workspace-scoped feeds keep the existing workspace lookup. The run hook filters
both by workspace and by run id before appending a `run.event`, while status reconnects invalidate
the persisted run-events query as it does today. This prevents a frame from Alpha being treated as a
Beta run while allowing all cards to share the one global source.

### Treat reconnect recovery as read reconciliation

The global client retains its per-workspace durable cursor across disconnects and sends it on the next
URL. On reconnect, active run consumers invalidate their persisted event query; global roster/query
consumers receive normal durable events and invalidations. This is required because ephemeral frames
are intentionally not replayed, and it also makes a stalled connection converge even if the browser
does not report every intermediate error.

## Risks / Trade-offs

- [Risk] A daemon with many workspaces writes more events through one response and can build a queue
  during a slow client. → Bound each workspace replay batch, preserve the existing 15-second
  heartbeat, and close all subscriptions on abort; tests cover cleanup and ordering.
- [Risk] A malformed or very large cursor could make reconnect expensive. → Bound the encoded cursor
  input and treat invalid entries as fresh-tail positions; never accept a cursor for an unloaded
  workspace.
- [Risk] Global query consumers may miss ephemeral frames while disconnected. → Keep ephemeral frames
  explicitly non-replayable and invalidate/refetch authoritative worker and run reads on reconnect.
- [Risk] Existing tests assume `FanInStreams` discovers one fake source per workspace. → Update those
  tests to assert one global URL and add a focused local-stream test so workspace behavior remains
  covered.

## Migration Plan

The endpoint and client option are additive. Deploy the server route and client together; old clients
continue using `/api/w/:ws/events`, and new clients fall back to their existing local stream only for
workspace-scoped surfaces. Rollback is a normal release rollback because no schema or persisted data
changes.
