# live-streams/connection-state Specification

## Purpose
Defines the connection-state contract every per-entity live SSE stream in the web app SHALL
expose to the surface watching it — the run event stream and the job stream today — so a dropped
connection is visible and self-recovering wherever one of these streams is open, the same way it
already is for the workspace event stream.

## Requirements

### Requirement: A live stream reports one of a fixed set of connection states

A live stream SHALL report its connection as exactly one of `connecting`, `connected`, `stale`,
`reconnecting`, `offline` or `hidden` at all times, and SHALL make that state readable by the
surface watching it. `stale` SHALL mean the stream is open but has received no frame or heartbeat
for longer than the staleness threshold, and SHALL be distinct from a connection that has actually
dropped.

#### Scenario: Opening

- **WHEN** a surface opens a live stream
- **THEN** the stream reports `connecting` until the connection is established or fails

#### Scenario: Established

- **WHEN** the stream's connection opens successfully
- **THEN** the stream reports `connected`

#### Scenario: Open but silent

- **WHEN** the stream's connection remains open and no frame or heartbeat arrives for the staleness
  threshold
- **THEN** the stream reports `stale` rather than `connected`

#### Scenario: Dropped while the device is online

- **WHEN** the stream's connection fails and the device reports itself online
- **THEN** the stream reports `reconnecting`

#### Scenario: Dropped while the device is offline

- **WHEN** the stream's connection fails while the device reports itself offline, or the browser
  reports an `offline` event
- **THEN** the stream reports `offline`, distinct from `reconnecting`

### Requirement: A live stream retries indefinitely with bounded backoff

A live stream that is not reporting `connected` SHALL keep attempting to reconnect for as long as
the surface holds it open. The delay between attempts SHALL grow with consecutive failures up to
a fixed ceiling and SHALL NOT grow without bound, and the stream SHALL NOT stop retrying and SHALL
NOT require a page reload to recover.

#### Scenario: Many consecutive failures

- **WHEN** a live stream's connection fails repeatedly over an extended period
- **THEN** it keeps attempting to reconnect at no more than the ceiling delay between attempts,
  rather than giving up

#### Scenario: The connection recovers on its own

- **WHEN** the server becomes reachable again while a live stream is retrying
- **THEN** the next attempt succeeds and the stream reports `connected` without any action from
  the surface

### Requirement: The device coming back online reconnects immediately

A live stream SHALL attempt a fresh reconnect immediately when the browser reports its `online`
event, rather than waiting out the current backoff delay and rather than trusting a socket that may
be half-open. A reconnect from this path SHALL re-sync the reads the stream keeps fresh
(`A reconnect refreshes the reads the stream keeps fresh`). A stream paused because its document is
hidden SHALL stay paused until the document becomes visible.

#### Scenario: The device regains connectivity

- **WHEN** a live stream is reporting `reconnecting` or `offline` and the browser fires its
  `online` event
- **THEN** the stream attempts to reconnect at once, not after the remaining backoff delay

#### Scenario: The device was never marked offline

- **WHEN** the browser fires its `online` event while a stream still reports `connected` on a socket
  that has gone silent
- **THEN** the stream still opens a fresh connection and re-syncs its reads, rather than keeping the
  socket it cannot trust

### Requirement: A surface can force an immediate retry

A live stream SHALL let the surface watching it trigger an immediate reconnect attempt on
demand, independent of the current backoff delay or connection state.

#### Scenario: The human asks to retry now

- **WHEN** the surface invokes the stream's manual retry while it is reconnecting or offline
- **THEN** the stream attempts to reconnect immediately, and reports `connecting` while doing so

### Requirement: Reconnecting never loses or duplicates activity

A live stream that resumes after a drop SHALL continue from the highest position it had already
delivered to the surface, so nothing the surface already showed is delivered again. A stream's
resume position covers only durable events: ephemeral frames are never replayed, and a resumed
position the server no longer holds (a restarted, replaced or reset daemon) yields no replay at all.
Every reconnect SHALL therefore refresh the reads that stream keeps fresh
(`A reconnect refreshes the reads the stream keeps fresh`), so nothing that happened while
disconnected is missing.

#### Scenario: A gap while disconnected

- **WHEN** the server produced further durable activity for the entity a live stream is watching
  while that stream was disconnected
- **THEN** on reconnecting, the stream delivers that activity once the connection is
  re-established, without repeating what the surface already has

#### Scenario: A gap in ephemeral frames or a lost position

- **WHEN** a stream missed live-only frames while disconnected, or the server no longer holds the
  position the client resumed from
- **THEN** the reconnect refreshes the reads behind those frames, so the surface converges on the
  authoritative state even though no frame replays

### Requirement: A live stream pauses while its document is hidden

A live stream that is open in a document the browser reports as hidden SHALL close its persistent connection until that document becomes visible again. While hidden, the stream SHALL report a non-connected state that is distinct from a dropped connection the surface must manually recover. When the document becomes visible, the stream SHALL reconnect from the highest position it had already delivered, the same way it resumes after any other drop (`Reconnecting never loses or duplicates activity`).

This SHALL hold for the workspace event stream, the run event stream, and the job stream.

#### Scenario: Background tab releases its connections

- **WHEN** a live stream is connected and the document becomes hidden
- **THEN** that stream’s persistent connection is closed, and it is not held open in the background

#### Scenario: Returning to the tab resumes from the last position

- **WHEN** a live stream was paused because its document was hidden, and the document becomes visible
- **THEN** the stream reconnects and delivers activity that happened while it was paused, without repeating what the surface already has

#### Scenario: A hidden document does not look like a manual retry

- **WHEN** a live stream is paused because its document is hidden
- **THEN** the surface is not required to invoke manual retry to recover, and becoming visible is enough

### Requirement: Persistent streams leave room for ordinary requests

The web app SHALL NOT hold so many persistent streams to the daemon, in one document or across
documents of the same origin, that ordinary HTTP requests to the same origin cannot complete.
Opening global Live, global Chats, or several workspace tabs at once SHALL still allow thread list,
thread messages, and message-send requests to start and finish.

Global surfaces that observe more than one workspace SHALL use one daemon-wide multiplexed live
connection per document, independent of the number of listed workspaces. A workspace-scoped surface
SHALL retain at most one live workspace subscription for that workspace, shared by its consumers.
The hidden-document pause/resume requirement still applies to both stream forms.

#### Scenario: Chats in a new tab while Live is open in another

- **WHEN** one document is showing global Live with live workers and another document of the same origin opens global Chats
- **THEN** Chats' thread-list and messages requests complete, rather than remaining in flight for as long as the Live document holds its one multiplexed stream

#### Scenario: One page with many workspaces

- **WHEN** the daemon reports ten workspaces and global Live is the only document open
- **THEN** global Live holds one daemon-wide live connection, not ten persistent workspace connections, and its ordinary requests complete

#### Scenario: A workspace page keeps its local stream bound

- **WHEN** a workspace-scoped Live page has several live workers and several components consume their events
- **THEN** those consumers share at most one persistent stream for that workspace

### Requirement: A stale stream is displayed honestly

A surface SHALL NOT display a fresh connected state for a stream that has gone `stale`. While a
stream is stale but not yet declared dead, its connection indicator SHALL show the age of the last
received frame — the time it last heard from the daemon — instead of implying current data.

#### Scenario: Indicating a stale stream

- **WHEN** a stream reports `stale`
- **THEN** its surface shows that updates have not arrived since the last frame's time, rather than
  a fresh `connected` state

### Requirement: A live stream detects a half-open connection with a heartbeat watchdog

A live stream SHALL track the time of the last frame or heartbeat it received and SHALL treat the
connection as dead when nothing arrives for a bounded watchdog window (about 2.5 heartbeat
intervals). On declaring the connection dead it SHALL close the socket, report `reconnecting`, and
reopen from its latest resume position, without waiting for the socket to report an error. A stream
that keeps receiving frames or heartbeats within the window SHALL NOT be reconnected.

#### Scenario: A silent stream is declared dead and reconnects

- **WHEN** a connected stream delivers some frames and then goes silent with no error, and the
  watchdog window elapses
- **THEN** the stream closes that socket, reports `reconnecting`, and reopens at its latest resume
  position, then reports `connected` when the new connection opens

#### Scenario: A healthy idle stream is left alone

- **WHEN** a connected stream receives a frame or heartbeat within every watchdog window
- **THEN** it is never closed or reconnected by the watchdog

#### Scenario: A hidden stream is not watched

- **WHEN** the document is hidden and the stream has closed its connection
- **THEN** the watchdog does not declare it dead, and the stream stays paused until the document is
  visible again

### Requirement: A live stream re-syncs when the tab or machine wakes

A live stream SHALL force a fresh reconnect, and re-sync its reads, when the machine or tab wakes
rather than trusting the socket that survived the sleep: on the browser `online` event, on
`visibilitychange` back to visible for a stream that had paused, and on a watchdog tick whose
actual elapsed time is far larger than its scheduled interval (a slept machine).

#### Scenario: The machine slept with the tab visible

- **WHEN** a watchdog tick fires far later than it was scheduled, because the machine was asleep
  while the tab stayed visible
- **THEN** the stream forces a fresh reconnect and re-syncs its reads instead of keeping the socket

#### Scenario: Returning to a hidden tab

- **WHEN** a hidden document becomes visible again
- **THEN** the stream reconnects and re-syncs its reads

### Requirement: A reconnect refreshes the reads the stream keeps fresh

Every reconnect of a workspace or daemon-wide stream SHALL invalidate the reads that stream keeps
fresh — at least the worker list, ticket list, briefing, runs, decisions and the workspace list —
so a gap in events cannot leave live counts or worker rows wrong. A daemon-wide stream SHALL do this
for every workspace it has received an event for.

#### Scenario: A reconnect refreshes live data

- **WHEN** a live stream reconnects after a drop
- **THEN** the reads it keeps fresh are refetched, so worker rows and live counts reflect the server
  even when no replayed frame covered the gap

#### Scenario: A daemon-wide reconnect covers each seen workspace

- **WHEN** the daemon-wide stream reconnects and it had received events for workspaces Alpha and
  Beta
- **THEN** both Alpha's and Beta's stream-backed reads are refreshed
