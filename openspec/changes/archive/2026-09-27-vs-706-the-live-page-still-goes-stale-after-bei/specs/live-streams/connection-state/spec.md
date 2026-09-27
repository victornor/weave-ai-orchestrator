## ADDED Requirements

### Requirement: A stream-backed view converges after being left alone

A stream-backed surface, including global Live, SHALL show the server's current state of the reads its stream keeps fresh within a few seconds of the human returning to it, without a page reload. This SHALL hold when the document was hidden longer than the watchdog window, when the machine slept with the document still visible, and when the document stayed visible and idle past the watchdog window. Returning SHALL be enough; the human SHALL NOT have to reload. While the document is hidden the stream SHALL still hold no persistent connection (the hidden-document pause).

#### Scenario: A backgrounded tab past the watchdog window

- **WHEN** a stream-backed view is connected, the document is hidden longer than the watchdog window, the server produces further activity, and the document becomes visible again
- **THEN** within a few seconds the view shows that activity without a page reload, and the persistent connection was not held open while the document was hidden

#### Scenario: The machine slept with the tab visible

- **WHEN** a stream-backed view is connected, the machine sleeps long enough that a scheduled watchdog tick overruns, the server produces further activity, and the machine wakes with the document still visible
- **THEN** within a few seconds the view shows that activity without a page reload

#### Scenario: A long idle visible tab

- **WHEN** a stream-backed view stays visible and receives no frame or heartbeat past the watchdog window, and the server produces further activity
- **THEN** the stream reconnects and the view shows that activity within a few seconds, without a page reload

## MODIFIED Requirements

### Requirement: A reconnect refreshes the reads the stream keeps fresh

Every reconnect of a workspace or daemon-wide stream SHALL invalidate the reads that stream keeps fresh — at least the worker list, ticket list, briefing, runs, decisions and the workspace list — so a gap in events cannot leave live counts or worker rows wrong. A daemon-wide stream SHALL do this for every workspace it has received an event for, and for every workspace whose reads the document already holds, even when that workspace has not yet emitted an event. A reconnect that has no resume cursor and therefore starts at the current tail SHALL still refresh those reads, because nothing is replayed.

#### Scenario: A reconnect refreshes live data

- **WHEN** a live stream reconnects after a drop
- **THEN** the reads it keeps fresh are refetched, so worker rows and live counts reflect the server even when no replayed frame covered the gap

#### Scenario: A daemon-wide reconnect covers each seen workspace

- **WHEN** the daemon-wide stream reconnects and it had received events for workspaces Alpha and Beta
- **THEN** both Alpha's and Beta's stream-backed reads are refreshed

#### Scenario: A daemon-wide reconnect covers a workspace that has not yet emitted

- **WHEN** the document is already showing a workspace's worker list, the daemon-wide stream has received only heartbeats and no event for that workspace, and the stream reconnects with no resume cursor
- **THEN** that workspace's worker list and the other reads the stream keeps fresh are refetched, even though no event was seen and no cursor replayed the gap
