## Purpose

Defines the keepalive and write-liveness contract of the daemon's live SSE endpoints, so a client
can distinguish a healthy idle stream from a half-open one and a stalled client is dropped rather
than holding a stream loop open forever.

## ADDED Requirements

### Requirement: Every live SSE endpoint sends an observable heartbeat

While a live SSE response is open and no event is pending, the daemon SHALL send a heartbeat that a
browser `EventSource` client can observe as a named `heartbeat` event, at a fixed interval. The
heartbeat SHALL carry a payload the client can timestamp and SHALL NOT carry an `id`, so it never
advances a client's replay cursor or replays as a durable event. The same framing SHALL be used by
the workspace event stream, the daemon-wide event stream, the per-run event stream and the job
stream.

#### Scenario: An idle stream is visibly alive

- **WHEN** no event has been emitted for one heartbeat interval while a live SSE response remains open
- **THEN** the client receives a named `heartbeat` event rather than an SSE comment it cannot observe

#### Scenario: A heartbeat does not move the replay position

- **WHEN** a client receives a heartbeat and later reconnects with its last `after`/cursor value
- **THEN** the heartbeat has not changed that position and no durable event is replayed or skipped
  because of it

#### Scenario: An older client is not broken by the frame

- **WHEN** a client that registered no `heartbeat` listener receives a heartbeat on the stream
- **THEN** it is unaffected, because a named event with no listener is ignored

### Requirement: A stalled write ends the stream instead of holding it open

A live SSE response SHALL bound the time any single write may take. When a write to a slow or gone
client does not complete within that bound, the daemon SHALL stop the stream loop and end the
response so the client reconnects, rather than waiting on the write indefinitely.

#### Scenario: A client that never drains

- **WHEN** a write to an SSE client does not complete within the write timeout
- **THEN** the daemon aborts that response and releases its subscriptions

#### Scenario: A healthy client is unaffected

- **WHEN** an SSE client keeps draining its stream
- **THEN** no write exceeds the timeout and the stream continues normally
