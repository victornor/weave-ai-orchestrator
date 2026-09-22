## ADDED Requirements

### Requirement: A message to a running session interrupts and resumes on the same session

When a human sends a message to a ticketless persistent session whose turn is executing, the system SHALL interrupt that turn immediately, in the way the runtime's own interactive stop stops a turn — the model and any tool call in progress are stopped — and SHALL start the agent's next turn on the same session carrying the human's message. The message SHALL NOT wait for the running turn to finish, and SHALL NOT be injected into the turn that is being stopped.

#### Scenario: A message stops the running turn

- **WHEN** a human sends a message to a ticketless persistent session while its turn is executing
- **THEN** the executing turn is interrupted, and the agent's next turn starts on the same session carrying that message

#### Scenario: The session keeps its context

- **WHEN** that next turn starts after the interrupt
- **THEN** it resumes the same runtime session, with the conversation's prior context intact

#### Scenario: A message to an idle session is unchanged

- **WHEN** a human sends a message to a ticketless persistent session with no turn executing
- **THEN** it is queued and delivered at the start of the agent's next turn, as before

#### Scenario: A ticketed worker and the weaver are unaffected

- **WHEN** a human sends a message to a ticketed worker, or to the weaver, while a turn is executing
- **THEN** its existing delivery behaviour is unchanged by this requirement

### Requirement: Rapid messages during the stop coalesce into one resumed turn

Messages that arrive while the session's turn is stopping SHALL be coalesced into the single resumed turn, in the order they were sent. No message SHALL be delivered more than once, and no message SHALL start a second turn while a turn interrupted for an earlier message is still stopping.

#### Scenario: Two rapid messages start one turn

- **WHEN** a human sends a second message before the interrupted turn has stopped and the resumed turn has started
- **THEN** exactly one resumed turn runs, carrying both messages in order

#### Scenario: Every message is delivered exactly once

- **WHEN** several messages were sent during the interrupt
- **THEN** each appears exactly once in the resumed turn

#### Scenario: A message after the resumed turn starts is a new interrupt

- **WHEN** a message is sent after the resumed turn has already started
- **THEN** it interrupts that turn under the same rule, rather than being appended to it

### Requirement: The interrupted turn stays visible and is marked

An interrupted session turn SHALL remain in the conversation with the transcript it had produced, SHALL be marked as interrupted, and each of its tool calls that produced no result SHALL be shown as not completed.

#### Scenario: The transcript is kept and marked

- **WHEN** a session turn is interrupted by a human message
- **THEN** the conversation still shows the turn's transcript and marks the turn interrupted

#### Scenario: A cut-off tool call is not completed

- **WHEN** the interrupted turn had issued a tool call that produced no result
- **THEN** that tool call is shown as not completed

### Requirement: Every runtime a session can use interrupts on a new message

The interrupt-and-resume behaviour SHALL hold on every runtime a persistent session can run on, including claude, codex, opencode and the built-in runtime. A runtime that cannot be interrupted cleanly SHALL be named, and what it does instead SHALL be shown to the human rather than the message being silently queued.

#### Scenario: Each session runtime interrupts

- **WHEN** a human sends a message to a running session on each runtime a session can use
- **THEN** the running turn is interrupted on each, and the resumed turn carries the message

#### Scenario: A runtime that cannot interrupt cleanly is named

- **WHEN** a session runs on a runtime that cannot stop its running turn cleanly
- **THEN** the surface names that runtime and what it does instead, and never reports a silent queue

### Requirement: The session composer says a send will interrupt

Before the human types, a session's composer SHALL state whether sending now reaches the running turn, interrupts it, or is queued, naming the reason when it is queued. For a ticketless session whose turn is executing, it SHALL say the message interrupts the running turn and that the agent answers once its next turn starts.

#### Scenario: The composer warns before typing

- **WHEN** a human opens the composer of a ticketless session whose turn is executing
- **THEN** the composer labels the input as interrupting the running turn and answering after the next turn starts

#### Scenario: The label follows the turn starting and ending

- **WHEN** the session starts or finishes a turn
- **THEN** the composer's label reflects the refreshed state

### Requirement: A session's composer attaches files the way the conductor chat does

The composer of a ticketless persistent session SHALL accept attachments by its attach control, by pasting from the clipboard and by dropping files, applying the same accepted file types, the same per-message limit and the same rejection feedback as a conductor chat message, and SHALL send them in the same request as the message text.

#### Scenario: Attaching by the attach control

- **WHEN** the human picks an accepted file with the session composer's attach control
- **THEN** it appears attached to the composer, pending send, under the conductor chat's rules

#### Scenario: Attaching by paste

- **WHEN** the human pastes an image from the clipboard into the session composer
- **THEN** the image appears attached to the composer, pending send

#### Scenario: Several files

- **WHEN** the human attaches several accepted files
- **THEN** all of them, up to the per-message limit, appear attached to the composer, pending send

#### Scenario: An unacceptable file

- **WHEN** the human attaches a file whose type is not accepted, or one over its size cap
- **THEN** the request is rejected before anything is stored, and the composer states the reason

### Requirement: A session's attachment is stored with the message and shown on it

A message sent from a session's composer with attachments SHALL store them under the conductor chat's attachment rules, and the session's conversation SHALL show them on the human's message, both immediately after sending and after a reload.

#### Scenario: Stored under the existing caps

- **WHEN** a session message carries an accepted attachment
- **THEN** it is stored with that message and served through the authenticated thread route

#### Scenario: Shown on the human's message

- **WHEN** the conversation shows a human message that carried an attachment
- **THEN** the attachment is shown on that message, and identically after a reload

### Requirement: A session's attachment reaches the agent

An attachment on a message to a session SHALL reach the session agent through the same mechanism a conductor chat message uses — the agent's inbox returns an image's bytes as image content and a text document's literal content — and the turn prompt SHALL name that the message carried attachments and point the agent at its inbox for them.

#### Scenario: The agent can read the attachment

- **WHEN** a session's turn was woken by a message carrying an image attachment and the agent calls its inbox tool
- **THEN** the inbox result carries the image's content

#### Scenario: The prompt names the attachment

- **WHEN** a session turn's prompt is built for a message that carried attachments
- **THEN** the prompt names that the message carried them and points at the inbox tool
