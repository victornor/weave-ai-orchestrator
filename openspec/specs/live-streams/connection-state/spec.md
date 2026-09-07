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
