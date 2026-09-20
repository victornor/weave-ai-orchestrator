# conductor-chat/dispatch-labels Specification

## Purpose
Defines what the conductor chat shows for work the conductor dispatched: a label that stays with the message that triggered it, survives later messages and a reload, and reports the dispatch's outcome once the work has ended — so the conversation is a readable history of what was done rather than a live presence indicator.

## Requirements

### Requirement: A ticket records the run that created it

A ticket SHALL record the identity of the agent run that created it, so that work the conductor filed during a turn can be attributed to that turn. A ticket created by a human or by the system, outside any run, SHALL record no run. The recorded run SHALL NOT change for the life of the ticket.

#### Scenario: Ticket created during an agent turn

- **WHEN** the conductor creates a ticket while taking a turn
- **THEN** the ticket records that turn's run as the run that created it

#### Scenario: Ticket created by a human

- **WHEN** a human creates a ticket directly
- **THEN** the ticket records no creating run, and the ticket is created successfully

#### Scenario: The record is stable

- **WHEN** a ticket is later reassigned, transitioned, worked by a second worker, or completed
- **THEN** the run recorded as having created it is unchanged

### Requirement: A dispatch label is anchored to the message that triggered it

The conductor chat SHALL render a dispatch label for each ticket that was created by the run behind a conductor message shown in the open thread and that is, or has been, assigned to a role. The label SHALL be rendered as an item of the message list, immediately after that conductor message. When a run produced more than one conductor message, the label SHALL be anchored to the last of them.

A ticket the conductor filed with no role assigned SHALL NOT be labelled, because nothing was dispatched.

#### Scenario: A dispatch is announced

- **WHEN** the conductor replies to the human in a turn in which it filed a ticket and assigned it to a role
- **THEN** a label for that dispatch appears directly after that reply in the chat

#### Scenario: A ticket filed for later

- **WHEN** the conductor files a ticket in a turn without assigning it to a role
- **THEN** no label for that ticket appears in the chat

#### Scenario: A run with several messages

- **WHEN** the conductor sends the human more than one message in the turn that filed a ticket
- **THEN** the label appears after the last of those messages, not after the first

### Requirement: A dispatch label keeps its position

A dispatch label SHALL keep its position in the conversation for as long as the thread is shown. Messages that arrive after it SHALL be rendered after it, and the label SHALL NOT be moved to the end of the conversation, whether the new message comes from the human or from the conductor.

#### Scenario: The human sends another message

- **WHEN** the human sends a new message after a dispatch label has appeared
- **THEN** the new message renders after the label, and the label stays directly after the conductor message it was anchored to

#### Scenario: A later turn dispatches again

- **WHEN** a later conductor turn files and assigns another ticket
- **THEN** the earlier label keeps its position and the new label appears after the later conductor message, in conversation order

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

### Requirement: Several dispatches from one message each get a label

When one conductor turn dispatched more than one piece of work, the chat SHALL render one label per dispatch after that turn's message, in the order the tickets were filed, and each label SHALL report its own dispatch's state independently.

#### Scenario: Two dispatches in one turn

- **WHEN** the conductor files and assigns two tickets in the same turn
- **THEN** two labels appear after that turn's message, in the order the tickets were filed

#### Scenario: Independent outcomes

- **WHEN** one of two dispatches from the same turn finishes while the other is still running
- **THEN** the finished one shows its outcome and the other continues to show a working state

### Requirement: Labels survive a reload

The chat SHALL derive dispatch labels from durable records only, so that reloading the page reproduces the same labels, in the same positions, with the state each dispatch is actually in at that moment. No label SHALL depend on the client having observed the dispatch happen.

#### Scenario: Reload after a dispatch

- **WHEN** the human reloads the chat after dispatches have been made
- **THEN** the same labels appear in the same positions in the conversation

#### Scenario: Reload after the work ended

- **WHEN** the human reloads the chat after a labelled dispatch has finished
- **THEN** the label is still present in its position and shows the finished outcome

#### Scenario: A dispatch made while the chat was closed

- **WHEN** the chat is opened for the first time after a turn that dispatched work
- **THEN** that turn's labels are shown, anchored to that turn's message

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

### Requirement: A dispatch label or worker chip shows its work's project colour

A dispatch label, and an unattributed worker chip shown below the conversation, SHALL colour
identifying text with the colour of the project (`workspace-navigation/project-colour`) that the
underlying ticket — or, for a chip standing for an agent with no ticket, the agent — belongs to.
On a dispatch label the coloured text SHALL be the ticket identifier. On a worker chip the
coloured text SHALL be the worker name. Neither SHALL show a separate project-colour circle.

The status glyph already carried by the label or chip SHALL remain the leftmost, primary signal;
the project colour SHALL be the colour of that identifying text, not a replacement for the glyph.

Work that has no project associated with it SHALL leave the identifying text in its default
colour, rather than a neutral or placeholder tint, and SHALL show no colour circle.

#### Scenario: A dispatch for a project's ticket

- **WHEN** a dispatch label is shown for a ticket that belongs to a project
- **THEN** the ticket identifier is shown in that project's colour, with no project-colour circle,
  alongside its existing status glyph

#### Scenario: A dispatch with no project

- **WHEN** a dispatch label is shown for a ticket that belongs to no project
- **THEN** the ticket identifier is not tinted with a project colour, and the label shows no
  colour circle

#### Scenario: An unattributed worker chip

- **WHEN** a worker chip is shown below the conversation for an agent whose project is known
- **THEN** the worker name is shown in that project's colour, with no project-colour circle

#### Scenario: Two dispatches from different projects are told apart

- **WHEN** two dispatch labels are shown for tickets belonging to two different projects
- **THEN** each label shows its own ticket identifier in that ticket's project colour,
  distinguishable from the other

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
