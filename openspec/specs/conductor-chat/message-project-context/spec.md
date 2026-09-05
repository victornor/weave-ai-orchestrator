# conductor-chat/message-project-context Specification

## Purpose
Defines how a human message to the conductor carries an optional project reference: how the human chooses it in the chat, how it is stored with the message, how it is shown back on the sent message, and how it reaches the conductor as structured context — so "do this" no longer has to name its project in prose.

## Requirements

### Requirement: A human message can carry an optional project reference

An inbound human message SHALL be able to carry a reference to one project in the workspace. The reference is optional: a message sent without one SHALL be accepted and SHALL behave exactly as a message sent before this capability existed.

When a reference is carried, it SHALL be stored durably with the message, and SHALL be returned with that message whenever the thread's messages are read.

#### Scenario: Message sent with a project

- **WHEN** a human message is sent to a thread with a project reference
- **THEN** the message is accepted, and reading the thread's messages afterwards returns that message with the same project reference

#### Scenario: Message sent without a project

- **WHEN** a human message is sent to a thread with no project reference
- **THEN** the message is accepted, is stored with no project reference, and the agent is woken exactly as it is for a message sent before this capability existed

#### Scenario: The conductor's own replies carry no project

- **WHEN** the conductor sends an outbound message to the thread
- **THEN** that message has no project reference

### Requirement: An unknown project reference is rejected

A message carrying a project reference that does not name a project of the message's own workspace SHALL be rejected with an error, and SHALL NOT be stored and SHALL NOT wake the agent. A project belonging to another workspace SHALL be treated the same as one that does not exist.

#### Scenario: Reference to a project that does not exist

- **WHEN** a human message is sent with a project reference that matches no project in the workspace
- **THEN** the request fails with an error, no message is stored in the thread, and no wake is enqueued

#### Scenario: Reference to another workspace's project

- **WHEN** a human message is sent with a project reference that names a project of a different workspace
- **THEN** the request fails in the same way as for a project that does not exist

### Requirement: The conductor receives the project reference as structured context

The wake raised by an inbound human message SHALL carry the message's project reference in its payload, alongside the thread, message and body it already carries. The payload SHALL identify the project both by its identifier and by its human-readable project key, so the conductor can act on it without a further lookup.

When the message carries no project reference, the payload SHALL say so explicitly rather than omitting the information ambiguously, and every other field SHALL be unchanged.

#### Scenario: The conductor reads its inbox after a message with a project

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried a project reference
- **THEN** the message entry's payload identifies that project by identifier and by key, in addition to the thread, message and body

#### Scenario: The conductor reads its inbox after a message with no project

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried no project reference
- **THEN** the message entry's payload reports no project, and the thread, message and body are as they were before this capability existed

#### Scenario: A message on a thread bound to a ticket

- **WHEN** a human message arrives on a thread that is bound to a ticket
- **THEN** it lands as a comment on that ticket and wakes that ticket's worker exactly as before, and the ticket's own project remains the project of record for that work

### Requirement: The conductor chat offers a project selector beside its input

The web conductor chat SHALL show a compact project selector next to the message input. The selector SHALL offer every project in the workspace that is not archived, plus one option meaning "no project", and the current choice SHALL be visible without opening the control.

Sending a message SHALL carry the current choice with it. Choosing the "no project" option SHALL send the message with no project reference.

#### Scenario: Choosing a project and sending

- **WHEN** the human picks a project in the selector and sends a message
- **THEN** the message is sent carrying that project as its reference

#### Scenario: Sending with no project chosen

- **WHEN** the human has the "no project" option selected and sends a message
- **THEN** the message is sent with no project reference

#### Scenario: The workspace has no projects yet

- **WHEN** the chat is open in a workspace that has no projects
- **THEN** the selector offers nothing to choose beyond "no project", and sending a message still works

#### Scenario: Sending while offline

- **WHEN** the human sends a message with a project chosen while the app is offline
- **THEN** the queued message retains that project reference and is sent with it when the queue is flushed

### Requirement: The selector defaults to the thread's last choice

When the chat opens a thread, the selector SHALL default to the project carried by the most recent human message in that thread, and SHALL default to "no project" when that message carried none or when the thread has no human messages yet.

The default SHALL be derived from the thread's own stored messages, so the same thread opened on another device offers the same default.

#### Scenario: Reopening a thread whose last message named a project

- **WHEN** the human opens a thread whose most recent message carried a project
- **THEN** the selector shows that project as the current choice

#### Scenario: Reopening a thread whose last message named no project

- **WHEN** the human opens a thread whose most recent message carried no project
- **THEN** the selector shows the "no project" option as the current choice

#### Scenario: A thread with no messages

- **WHEN** the human opens a thread that has no messages yet
- **THEN** the selector shows the "no project" option as the current choice

#### Scenario: Changing the choice within a session

- **WHEN** the human changes the selection and sends a message
- **THEN** subsequent messages in that session default to the new choice, and it remains the default after the chat is reloaded

### Requirement: A sent message shows the project it carried

A human message shown in the conductor chat SHALL display the project it was sent with, so the human can see afterwards what context went with it. A message sent with no project SHALL display no such marker and SHALL render as it did before this capability existed.

#### Scenario: A message sent with a project

- **WHEN** a human message that carried a project is rendered in the chat
- **THEN** it is shown with a marker naming that project

#### Scenario: A message sent without a project

- **WHEN** a human message that carried no project is rendered in the chat
- **THEN** no project marker is shown on it

#### Scenario: A project removed after the message was sent

- **WHEN** a message references a project that no longer exists in the workspace
- **THEN** the chat still renders the message and does not fail, showing whatever it can identify of the project
