# live-streams/connection-state Specification

## Purpose
Defines the connection-state contract every per-entity live SSE stream in the web app SHALL
expose to the surface watching it — the run event stream and the job stream today — so a dropped
connection is visible and self-recovering wherever one of these streams is open, the same way it
already is for the workspace event stream.

## Requirements

### Requirement: A live stream reports one of a fixed set of connection states

A live stream SHALL report its connection as exactly one of `connecting`, `connected`,
`reconnecting` or `offline` at all times while it is open, and SHALL make that state readable by
the surface watching it.

#### Scenario: Opening

- **WHEN** a surface opens a live stream
- **THEN** the stream reports `connecting` until the connection is established or fails

#### Scenario: Established

- **WHEN** the stream's connection opens successfully
- **THEN** the stream reports `connected`

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

A live stream that is reconnecting or offline SHALL attempt to reconnect immediately when the
browser reports its `online` event, rather than waiting out the current backoff delay.

#### Scenario: The device regains connectivity

- **WHEN** a live stream is reporting `reconnecting` or `offline` and the browser fires its
  `online` event
- **THEN** the stream attempts to reconnect at once, not after the remaining backoff delay

### Requirement: A surface can force an immediate retry

A live stream SHALL let the surface watching it trigger an immediate reconnect attempt on
demand, independent of the current backoff delay or connection state.

#### Scenario: The human asks to retry now

- **WHEN** the surface invokes the stream's manual retry while it is reconnecting or offline
- **THEN** the stream attempts to reconnect immediately, and reports `connecting` while doing so

### Requirement: Reconnecting never loses or duplicates activity

A live stream that resumes after a drop SHALL continue from the highest position it had already
delivered to the surface, so nothing the surface already showed is delivered again and nothing
that happened while disconnected is missing.

#### Scenario: A gap while disconnected

- **WHEN** the server produced further activity for the entity a live stream is watching while
  that stream was disconnected
- **THEN** on reconnecting, the stream delivers that activity once the connection is
  re-established, without repeating what the surface already has

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
