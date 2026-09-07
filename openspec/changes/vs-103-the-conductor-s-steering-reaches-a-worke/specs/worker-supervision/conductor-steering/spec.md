## Purpose

Defines what happens when the conductor steers a worker: the message reaches the worker's running
turn where the runtime can take it, waits for the worker's next turn otherwise, and the conductor is
told every time which of the two happened — so a correction sent while a worker is mid-turn is never
a guess about whether it landed in time.

## ADDED Requirements

### Requirement: The conductor's steering asks for mid-turn delivery by default

When the conductor sends a worker a message and does not say otherwise, the system SHALL attempt to
deliver that message to the worker's currently executing turn before falling back to queuing it for
the worker's next turn.

#### Scenario: The conductor steers a worker mid-turn on a capable runtime

- **WHEN** the conductor sends a message to a worker whose runtime supports mid-turn input and whose
  turn is executing and still able to receive input, and the conductor does not ask for queued
  delivery
- **THEN** the message is delivered to that turn and the outcome is reported as mid-turn delivery

#### Scenario: The conductor explicitly asks for the message to be queued

- **WHEN** the conductor sends a message and explicitly asks not to attempt mid-turn delivery
- **THEN** the message is queued for the worker's next turn even if a running turn could have taken it

### Requirement: The conductor is told which delivery happened

Every message the conductor sends to a worker SHALL report its outcome as either mid-turn delivery or
queued delivery, so the conductor can tell whether a correction landed inside the worker's current
turn or will apply starting with its next one.

#### Scenario: Mid-turn delivery is reported

- **WHEN** the conductor's message is delivered to the worker's executing turn
- **THEN** the conductor's tool call reports mid-turn delivery

#### Scenario: A worker whose runtime cannot take mid-turn input

- **WHEN** the conductor sends a message to a worker whose runtime does not support mid-turn input, or
  whose turn is not currently executing, or whose executing turn can no longer receive input
- **THEN** the message is queued for the worker's next turn and the conductor's tool call reports
  queued delivery — the conductor is never left to assume the message arrived

### Requirement: The conductor's steering is attributed as the conductor's, whichever way it is delivered

The message SHALL be recorded on the worker's ticket as the conductor's own words before any delivery
is attempted, whether that attempt succeeds, falls back to queued, or fails outright. Mid-turn
delivery changes only when the message arrives, never whether or how it is recorded.

#### Scenario: The record exists even when delivery fails outright

- **WHEN** the conductor sends a message and the attempt to deliver it mid-turn errors
- **THEN** the message is still recorded as the conductor's on the ticket and is queued for the
  worker's next turn

### Requirement: The conductor's steering never widens what a worker may do

Delivering the conductor's message mid-turn SHALL NOT change the worker's role permission mode, its
tool lists, or any approval gate, and SHALL NOT answer an open decision on the worker's ticket. A
message is instruction only.

#### Scenario: A mid-turn message leaves an open decision open

- **WHEN** the conductor delivers a message mid-turn to a worker with an open decision on its ticket
- **THEN** the decision remains open and the worker's permission mode and tool lists are unchanged

### Requirement: A message is delivered exactly once

The system SHALL NOT both deliver a conductor message mid-turn and also wake the worker for the same
message afterwards, and SHALL NOT drop a message that could not be delivered mid-turn.

#### Scenario: A mid-turn delivery does not also queue a wake

- **WHEN** the conductor's message is delivered to the worker's executing turn
- **THEN** no additional wake is queued for that same message

#### Scenario: A queued message is not silently lost

- **WHEN** the conductor's message could not be delivered mid-turn, for any reason
- **THEN** it is queued and wakes the worker at the start of its next turn
