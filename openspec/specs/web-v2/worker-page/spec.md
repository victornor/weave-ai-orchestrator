# web-v2/worker-page Specification

## Purpose
The V2 worker page: V1's worker detail restyled to the Mono language, over the shared live feed —
what the worker is doing, its brief, its session handover and a way to steer it.

## Requirements

### Requirement: The worker page renders in the V2 frame

The V2 worker page at `/v2/w/$ws/workers/$workerId` SHALL render inside the VS-343 V2 frame, show the
worker's name, status and identity metadata, and offer a Transcript tab and a Brief tab. A worker that
cannot be found SHALL show a not-found state rather than a blank page.

#### Scenario: Identity and tabs

- **WHEN** the human opens a worker's page
- **THEN** the worker's name, status and project/ticket metadata render, with Transcript and Brief
  tabs available

#### Scenario: The brief

- **WHEN** the human opens the Brief tab
- **THEN** the worker's brief renders as formatted markdown

#### Scenario: An unknown worker

- **WHEN** the address names a worker that does not exist
- **THEN** a not-found state is shown

### Requirement: Header actions match V1's worker controls

The header SHALL offer the worker's actions: a link to its ticket, Resume when it is paused, the
session and give-it-back controls, Relaunch and Cancel. The actions shown SHALL follow the worker's
own state, so an action that does not apply is not offered.

#### Scenario: A paused worker can resume

- **WHEN** the worker is paused and not held by a human
- **THEN** a Resume action is offered

#### Scenario: Ticket link

- **WHEN** the worker is on a ticket
- **THEN** the header links to that ticket

### Requirement: The transcript follows the worker's current turn

The Transcript tab SHALL render the worker's live feed through the shared V2 worker feed, following the
turn while it runs and showing the worker's most recent turn between turns, preserving the transcript
renderer's edit diffs and indentation.

#### Scenario: Following a running turn

- **WHEN** the worker is running a turn
- **THEN** its transcript streams in the shared feed

#### Scenario: Between turns

- **WHEN** the worker's turn has ended
- **THEN** the page still shows that most recent turn

### Requirement: The session-handover band

When the human holds the worker's session, the page SHALL show the handover command and a way to give
the session back with a note; when the session is resumable it SHALL offer to take the session.

#### Scenario: Giving a held session back

- **WHEN** the human gives back a held session with a note
- **THEN** the session is ended with that note and the band returns to its un-held state

### Requirement: The steer composer posts a ticket comment and reports delivery

Where the worker is on a ticket, the page SHALL offer a steer composer that posts to the worker's
ticket conversation and wakes it, shares its draft with the ticket reply box, and reports whether the
message reached the running turn, interrupted it, or was queued for the next turn.

#### Scenario: Steering a worker

- **WHEN** the human sends a steer message
- **THEN** it is posted to the ticket, the worker is woken, and the outcome is reported

#### Scenario: The draft is shared

- **WHEN** a note is started on the worker page
- **THEN** the ticket's reply box shows the same draft
