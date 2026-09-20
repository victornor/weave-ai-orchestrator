## ADDED Requirements

### Requirement: A weaver message carries a strip of the tickets it references

For every outbound (conductor) message, the conductor chat SHALL render a ticket strip under that
message when the message references at least one ticket. A message SHALL be treated as referencing a
ticket when its body contains a ticket identifier matching the workspace's `PREFIX-n` pattern (the
shared identifier parser), or when the turn behind the message recorded a dispatch for that ticket.

The strip SHALL list the referenced tickets de-duplicated by ticket, in order of first mention in the
message body; a ticket that appears only as a recorded dispatch SHALL follow the mentioned tickets in
the order its dispatch was recorded. Each reference SHALL be resolved to a real ticket in the
workspace, and an identifier that resolves to no ticket SHALL be silently omitted rather than shown as
a broken chip. A ticket named several times in one message SHALL appear once.

Each chip SHALL show the ticket's identifier, an acting name and the ticket's current status with the
existing status glyph and hue. The acting name SHALL be the name of the ticket's worker once a worker
exists (a worker's name carries its role), and the ticket's title before one does. The status SHALL be
the ticket's current status as the chat already knows it, updated live from the ticket and worker
queries the chat refreshes on their events, with no page reload, no new polling and no second
connection; a ticket with a live worker SHALL read as working.

A strip SHALL show at most six chips and, when the message references more, a `+N more` chip that
expands the remaining chips in place. A chip SHALL open its ticket through the chat's one shared
ticket link handler, so a chip and an identifier in the message text behave identically.

History SHALL behave like new messages: an older message's strip SHALL show the tickets' current
status, not the status at the time of the message, and a ticket that no longer exists SHALL be
omitted.

#### Scenario: A message merely mentioning tickets

- **WHEN** a conductor message names two ticket identifiers in its text and its turn dispatched none
- **THEN** a strip with one chip per ticket renders under that message

#### Scenario: A ticket mentioned several times

- **WHEN** one conductor message names the same ticket five times
- **THEN** the strip shows that ticket once

#### Scenario: An identifier that resolves to no ticket

- **WHEN** a conductor message names an identifier that matches no ticket in the workspace
- **THEN** no chip renders for it, and the other referenced tickets still render

#### Scenario: A dispatch the message did not name

- **WHEN** a turn filed and assigned a ticket without naming it in the reply
- **THEN** the ticket still renders as a chip under that reply

#### Scenario: A dispatch and a mention of the same ticket

- **WHEN** a message names a ticket and its turn also recorded a dispatch for that ticket
- **THEN** that ticket renders once, not twice

#### Scenario: More than six references

- **WHEN** a conductor message references more than six tickets
- **THEN** six chips and a `+N more` chip render, and activating `+N more` reveals the remaining chips in place

#### Scenario: The status moves without a reload

- **WHEN** a chipped ticket moves from working to in review to merged while the chat is open
- **THEN** each chip's status updates as the ticket moves, without the page reloading and without a new poll or connection

#### Scenario: An older message shows the current status

- **WHEN** the human scrolls back to a conductor message whose chipped ticket has since moved on
- **THEN** its strip shows the ticket's current status, not the status it had when the message was sent

#### Scenario: The acting name before and after a worker exists

- **WHEN** a referenced ticket has no worker, and later a worker is spawned for it
- **THEN** the chip shows the ticket's title first and the worker's name once the worker exists

## MODIFIED Requirements

### Requirement: Dispatches that cannot be attributed are still shown

Work that cannot be attributed to a conductor message in the open thread — a worker the human started
directly, a ticket created before the chat recorded creating runs, or a turn that dispatched work
without messaging the human — SHALL still be visible in the chat, in a region below the conversation,
for as long as that work is live. Such work SHALL NOT be rendered as an anchored label.

A live worker whose ticket already has a chip under some message in the thread SHALL NOT also appear
in the region below the conversation: the region SHALL be kept for workers whose ticket no message
references.

#### Scenario: A worker the human started

- **WHEN** a worker is running for a ticket that no conductor message in the thread accounts for
- **THEN** it is shown in the region below the conversation rather than anchored to a message

#### Scenario: Nothing unattributed

- **WHEN** every live dispatch is attributable to a message in the thread
- **THEN** no region below the conversation is shown

#### Scenario: A worker the thread already chipped

- **WHEN** a worker is running for a ticket that a conductor message in the thread already renders as a chip
- **THEN** that worker does not also appear in the region below the conversation

### Requirement: A dispatch label reports the dispatch's outcome

A dispatch label SHALL show a working state for as long as its work is being carried out, and SHALL remain in place when the work ends, showing the dispatch's outcome instead of disappearing.

The outcome SHALL be truthful about the real state of the work:

- a completed ticket SHALL read as a success;
- a cancelled ticket, or a worker that ended in error, SHALL read as a failure;
- work that has ended for now without being finished — waiting on the human, blocked, or merging — SHALL read as that state rather than as a success or a failure.

A label SHALL identify the work it stands for, naming the acting agent when one exists and the ticket it is working, and SHALL open the ticket it stands for through the chat's one shared ticket link handler, so activating a label and activating an identifier in the message text behave identically.

#### Scenario: Work in progress

- **WHEN** the worker for a labelled dispatch is running
- **THEN** the label shows a working state

#### Scenario: Work finishes successfully

- **WHEN** the ticket of a labelled dispatch reaches its completed state and its worker is retired
- **THEN** the label stays in place and shows a success outcome

#### Scenario: Work fails

- **WHEN** the ticket of a labelled dispatch is cancelled, or its worker ends in an error state
- **THEN** the label stays in place and shows a failure outcome

#### Scenario: Work is waiting on the human

- **WHEN** a labelled dispatch has produced work awaiting the human's review or is blocked
- **THEN** the label shows that state rather than a success or a failure

#### Scenario: The label is a way in

- **WHEN** the human activates a dispatch label or a reference chip
- **THEN** the chat opens that ticket through the shared ticket link handler, exactly as activating an identifier in the message text does
