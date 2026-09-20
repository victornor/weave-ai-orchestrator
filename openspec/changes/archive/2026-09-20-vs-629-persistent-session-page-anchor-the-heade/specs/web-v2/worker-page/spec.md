## ADDED Requirements

### Requirement: The worker page pins its header and bounds its frame

The V2 worker page SHALL fill the V2 frame rather than scroll as a document. Its header row — the
worker's status, name, identity metadata, actions and the session controls it carries — SHALL be
pinned at the top, and its composer SHALL be pinned at the bottom, while the tab body between them is
the single scrolling region. The page root SHALL be height-bounded by the shell at every viewport,
including phone width with the on-screen keyboard open, so the document itself never scrolls. This
SHALL hold both for a persistent session and for a ticket-run worker, and SHALL NOT be achieved by a
second, fixed-position copy of the header.

#### Scenario: The header stays while the transcript scrolls

- **WHEN** the worker's transcript is longer than the viewport and the human scrolls it
- **THEN** the transcript scrolls within the tab body while the header stays visible at the top

#### Scenario: The document does not scroll

- **WHEN** the worker page is shown at any viewport, including a phone with the on-screen keyboard open
- **THEN** the page root is bounded to the visible area and the document itself does not scroll

#### Scenario: The composer stays at the bottom

- **WHEN** the worker page shows a composer for a ticket-run worker or a persistent session
- **THEN** the composer stays at the bottom of the frame while the tab body scrolls

#### Scenario: The brief tab scrolls within the tab body

- **WHEN** the human opens the Brief tab and the brief is longer than the region
- **THEN** the brief scrolls inside the tab body with the header still pinned

#### Scenario: A ticket-run worker's feed keeps its own bounded box

- **WHEN** the page shows an ordinary ticket-run worker rather than a session
- **THEN** the shared worker feed keeps its own bounded transcript box inside the tab body, and the
  page document still does not scroll