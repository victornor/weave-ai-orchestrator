## ADDED Requirements

### Requirement: Global Live uses one multiplexed connection for its workspace cards

The global V2 Live screen SHALL obtain live worker activity for all workspace cards from one
daemon-wide multiplexed live connection per document, rather than opening one persistent connection
per workspace or per card. Events SHALL be routed to the card's workspace and run, and the existing
card filtering, ordering, between-turn handoff and connection-state presentation SHALL remain intact.

#### Scenario: Ten workspaces do not multiply Live connections

- **WHEN** `/v2/live` displays workers from ten workspaces
- **THEN** the page holds one daemon-wide live connection and every card still receives events for its own workspace

#### Scenario: A workspace event reaches only its matching card data

- **WHEN** a run event is emitted for a worker in workspace Alpha while Alpha and Beta cards are shown
- **THEN** Alpha's card updates from the event and Beta's card does not consume it as its own run event

#### Scenario: Live recovers after backgrounding

- **WHEN** the Live document is hidden, its multiplexed connection closes, events occur, and the document becomes visible
- **THEN** the connection resumes and every affected card converges to current worker and run data without a page reload
