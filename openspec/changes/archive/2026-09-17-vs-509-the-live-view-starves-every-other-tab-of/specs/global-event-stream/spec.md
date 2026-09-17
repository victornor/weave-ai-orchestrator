## Purpose

Provides one authenticated daemon-wide live-event connection for global web surfaces, while preserving workspace identity and replay so a page can observe many workspaces without exhausting the browser's per-origin connection pool.

## ADDED Requirements

### Requirement: The daemon exposes one authenticated stream for all loaded workspaces

The daemon SHALL expose an authenticated SSE endpoint that emits the same `WorkspaceEvent` payloads
as the workspace event endpoint for every currently loaded workspace. Every frame SHALL retain its
`workspaceId`, event type and payload, including ephemeral worker-activity and run-event frames.
The endpoint SHALL use the same operator/session authorization as the existing workspace event
endpoint and SHALL reject unauthenticated access.

#### Scenario: Events from multiple workspaces share one response

- **WHEN** a client opens the daemon-wide event endpoint and workspaces Alpha and Beta each emit an event
- **THEN** the client receives both events on the one SSE response, with Alpha and Beta's `workspaceId` values unchanged

#### Scenario: An ephemeral run event is forwarded

- **WHEN** a run in workspace Alpha emits a live-only `run.event` frame
- **THEN** the daemon-wide stream forwards that named event without turning it into a durable replay position

#### Scenario: Unauthenticated access is refused

- **WHEN** a request without an operator session reaches the daemon-wide event endpoint
- **THEN** the daemon refuses the request and opens no workspace event subscriptions

### Requirement: Reconnect replays each workspace from its own cursor

The daemon-wide endpoint SHALL accept a cursor map identifying the last delivered durable sequence
for each workspace. On a reconnect it SHALL replay every durable event after that workspace's cursor,
and SHALL then continue with new events. A missing workspace cursor SHALL mean that workspace's
current tail position, matching a fresh workspace stream rather than replaying its entire history.
Ephemeral frames SHALL not advance any cursor and SHALL be recovered by the consuming surface's
authoritative REST reads when they are missed.

#### Scenario: A reconnect fills a gap in one workspace

- **WHEN** a client reconnects with Alpha at sequence 4 and Beta at sequence 9, and Alpha produced sequences 5 and 6 while disconnected
- **THEN** the stream replays Alpha's sequences 5 and 6, does not replay Alpha's sequences 1 through 4 or Beta's sequences through 9, and then tails both workspaces

#### Scenario: A missed ephemeral frame converges from reads

- **WHEN** a client misses a live-only run event during a disconnect and reconnects
- **THEN** the stream does not invent a durable cursor for that frame, and the consuming run view can recover the authoritative rows from its REST read

### Requirement: The daemon-wide stream remains live until the client aborts

The daemon-wide endpoint SHALL send keepalive heartbeats while no event is pending and SHALL release
all workspace subscriptions when the client aborts or the stream finishes. A workspace added or
removed after the stream opens is not required to be included until the client reconnects.

#### Scenario: An idle connection stays detectable

- **WHEN** no workspace emits an event for one heartbeat interval while the daemon-wide stream remains open
- **THEN** the response receives a keepalive heartbeat rather than silently becoming idle

#### Scenario: Closing the response releases subscriptions

- **WHEN** the client aborts the daemon-wide stream
- **THEN** every workspace subscription held by that response is released
