# conductor-chat/live-turn-stream Specification

## Purpose
Defines what a conductor chat surface shows while a conductor turn is running: that the conductor is working, the text it produces as it produces it, and each tool call it makes — so the human can see progress instead of a static screen, and so the live view survives a reload without duplicating the final reply.

## Requirements

### Requirement: The conductor's current run is discoverable in one request

A chat surface SHALL be able to learn the conductor's identity and its most recent run from a single request to the conductor endpoint. The endpoint SHALL return a detail envelope carrying the conductor agent and its latest run (or `null` when the conductor has never run), rather than a bare agent record.

The run's status distinguishes a turn in progress from a finished one, so the surface can decide whether to open a live view without polling.

#### Scenario: Conductor with a run in progress

- **WHEN** a client requests the conductor detail while a conductor turn is executing
- **THEN** the response carries the conductor agent and the in-progress run, including that run's id and its running status

#### Scenario: Conductor that has never run

- **WHEN** a client requests the conductor detail before the conductor has taken a turn
- **THEN** the response carries the conductor agent and a null last run, and the request succeeds

#### Scenario: Existing clients keep working

- **WHEN** a first-party client that reads the conductor agent from the response consumes the detail envelope
- **THEN** it resolves the same agent it resolved before this change

### Requirement: The chat shows that the conductor is working

A conductor chat surface SHALL display an explicit working indicator for the whole time a conductor turn is running, and SHALL remove it when the turn ends. The indicator SHALL be driven by the run's lifecycle rather than only by the act of sending a message, so it is also shown for a turn the human did not start (a wake from a worker, a decision, or a schedule).

The indicator SHALL appear within a second or two of the human sending a message, without waiting for the conductor's first output.

#### Scenario: Sending a message

- **WHEN** the human sends a message to the conductor
- **THEN** the chat shows the working indicator immediately, and keeps showing it until the conductor's turn finishes

#### Scenario: A turn the human did not start

- **WHEN** a conductor turn starts from a wake that was not a human message
- **THEN** the chat shows the working indicator for that turn

#### Scenario: Turn ends

- **WHEN** the conductor's run reaches a terminal state, whether it succeeded, failed or was cancelled
- **THEN** the chat removes the working indicator

### Requirement: Assistant text streams into the chat while the turn runs

While a conductor turn is running, the chat SHALL render the assistant text the conductor produces as each piece of it arrives, not only when the turn completes. Consecutive pieces of assistant text SHALL read as continuous prose rather than as separate messages.

#### Scenario: Text arrives during the turn

- **WHEN** the conductor produces a block of assistant text partway through a turn
- **THEN** that text appears in the chat's live region before the turn finishes

#### Scenario: Successive text blocks

- **WHEN** the conductor produces several assistant text blocks in the same turn with no tool call between them
- **THEN** they render as one continuous passage, not as repeated separate entries

### Requirement: Each tool call appears as a compact, secondary block

While a conductor turn is running, the chat SHALL render every tool call the conductor makes, as it happens, as its own block showing the tool's name and a compact summary of its arguments. When the tool's result arrives, that result SHALL be folded into the same block — never rendered as a second, unrelated block — and the block SHALL indicate whether the call succeeded, failed or was denied.

The result's detail SHALL be available but not expanded by default, and tool blocks SHALL be visually secondary to the assistant text.

#### Scenario: A tool call begins

- **WHEN** the conductor invokes a tool
- **THEN** a block appears showing that tool's name and a compact summary of its arguments, marked as still running

#### Scenario: The tool's result arrives

- **WHEN** the result for a tool call arrives
- **THEN** the block for that call is updated in place with the outcome and its result detail, and no additional block is created for the result

#### Scenario: A tool call fails or is denied

- **WHEN** a tool call returns an error or is denied
- **THEN** its block is marked as failed or denied rather than successful

#### Scenario: Detail stays collapsed

- **WHEN** a tool block carries result detail
- **THEN** the detail is collapsed by default and can be expanded, so the assistant text remains the primary content

#### Scenario: Result without a matching call

- **WHEN** a tool result arrives whose originating call is not present in the events the surface holds
- **THEN** the result is still shown as its own block rather than discarded

### Requirement: The final reply is shown exactly once

The conductor's reply to the human is the outbound thread message it sends; that message is the durable record and SHALL remain the only place the reply text is shown once the turn is over. The live transcript SHALL be transient: it SHALL be cleared when the run finishes, and it SHALL NOT render the tool activity that delivers a reply to the human, so the reply never appears twice.

#### Scenario: Reply delivered mid-turn

- **WHEN** the conductor sends the human a message and then keeps working
- **THEN** the message appears once in the thread, and the tool activity that sent it does not appear in the live transcript

#### Scenario: Turn finishes

- **WHEN** the conductor's run finishes
- **THEN** the live transcript is cleared and the thread's messages are the only record shown

### Requirement: A reload mid-turn resumes the live view

When a chat surface loads while a conductor turn is already running, it SHALL show that turn's activity so far and continue receiving the rest of it, rather than showing an empty live region. When the connection to the live stream drops and is re-established, the surface SHALL resume from where it stopped without re-rendering activity it already showed and without silently losing activity that occurred while it was disconnected.

#### Scenario: Page reloaded mid-turn

- **WHEN** the human reloads the chat while a conductor turn is running
- **THEN** the chat shows the activity that turn has already produced and keeps appending new activity as it arrives

#### Scenario: Stream reconnects

- **WHEN** the live stream drops and reconnects during a turn
- **THEN** activity produced while disconnected is shown, and activity already shown is not duplicated

#### Scenario: No turn running

- **WHEN** the chat loads and the conductor is idle
- **THEN** no live region and no working indicator are shown, and the thread renders as before

### Requirement: The behavior holds on both human-facing chat surfaces

The working indicator, the streamed assistant text, the per-tool-call blocks, the single final reply and the mid-turn resumption SHALL apply to the web conductor chat and to the terminal conductor chat alike. The two surfaces MAY differ in presentation, but SHALL NOT differ in which activity they show.

#### Scenario: Terminal chat during a turn

- **WHEN** a conductor turn runs while the terminal chat is open
- **THEN** the terminal chat shows the working state, the streamed assistant text and the tool-call blocks for that turn

#### Scenario: Reply suppression is consistent

- **WHEN** the conductor delivers a reply to the human during a turn
- **THEN** both surfaces omit that delivery from the live transcript, applying the same rule
