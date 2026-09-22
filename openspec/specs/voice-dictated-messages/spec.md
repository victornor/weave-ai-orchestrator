# voice-dictated-messages Specification

## Purpose
Carries a human message's voice-dictated provenance from the composer to the text the agent is given, so an agent can expect misspellings and homophones, without ever altering the message the human sent or showing them a marker they did not write.

## Requirements

### Requirement: A dictated message tells the agent it may contain misspellings

When a human message was entered with the composer's voice dictation, the text the agent is given SHALL be preceded by a short line `(voice dictated)`, so the agent knows small misspellings, mangled command names and wrong homophones are likely and can infer the intended word. The stored human message SHALL show exactly what the human sent, without that line, and a message that was typed SHALL NOT be marked.

#### Scenario: A dictated message reaches the agent with the line

- **WHEN** a human sends a dictated message
- **THEN** the text delivered to the agent begins with the `(voice dictated)` line

#### Scenario: A typed message is never marked

- **WHEN** a human sends a message they typed
- **THEN** the delivered text carries no `(voice dictated)` line

#### Scenario: The stored message is unchanged

- **WHEN** a dictated message is delivered
- **THEN** the stored human message shows exactly what the human sent, with no `(voice dictated)` line

### Requirement: The mark reaches every agent a composer can dictate to

The `(voice dictated)` line SHALL be added wherever the composer can dictate: a message to the weaver, a message to a persistent session, and a ticket comment the human sends to a worker. The mark SHALL be added when the agent's prompt or inbox is built rather than stored with the message, so it reaches the agent on every runtime and every delivery path, including a message delivered into a running turn.

#### Scenario: The weaver's delivered prompt carries the line

- **WHEN** a human dictates a message to the weaver
- **THEN** the weaver's turn prompt contains the `(voice dictated)` line before the message

#### Scenario: A session's delivered prompt carries the line

- **WHEN** a human dictates a message to a persistent session
- **THEN** the session's turn prompt contains the `(voice dictated)` line before the message

#### Scenario: A dictated ticket comment to a worker carries the line

- **WHEN** a human dictates a comment on a worker's ticket
- **THEN** the worker's turn prompt contains the `(voice dictated)` line before the comment

#### Scenario: The inbox read shows the same mark

- **WHEN** an agent reads a dictated message through its inbox rather than its turn prompt
- **THEN** the same `(voice dictated)` line is shown before the message text

#### Scenario: A message delivered into a running turn carries the line

- **WHEN** a dictated message is delivered into a turn that is already running
- **THEN** the text that reaches the turn carries the `(voice dictated)` line

### Requirement: A human can mark all their messages as dictated

A setting "mark all my messages as voice dictated" SHALL be available, off by default, for a human who dictates everything. While it is on, every message that human sends SHALL be delivered with the `(voice dictated)` line, whether or not that particular message was dictated.

#### Scenario: Off by default

- **WHEN** a human has never changed the setting
- **THEN** only messages actually entered by dictation are marked

#### Scenario: On marks every message

- **WHEN** the setting is on and the human sends a typed message
- **THEN** the delivered text carries the `(voice dictated)` line

#### Scenario: Turning it off restores typed-only marking

- **WHEN** the setting is turned off
- **THEN** a typed message is no longer marked
