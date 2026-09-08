## MODIFIED Requirements

### Requirement: A human message can carry an optional reply reference

An inbound human message SHALL be able to carry a reference to one other message in the same thread. The
reference is optional: a message sent without one SHALL be accepted and SHALL behave exactly as a message
sent before this capability existed.

When a reference is carried, it SHALL be stored durably with the message, and SHALL be returned with that
message whenever the thread's messages are read.

A message SHALL carry at most one reply reference. A reference to a message that itself carries one SHALL
be accepted and SHALL be treated as a single reference to that message, with no chain followed.

#### Scenario: Message sent with a reply reference

- **WHEN** a human message is sent to a thread referencing an earlier message of that thread
- **THEN** the message is accepted, and reading the thread's messages afterwards returns that message with the same reference

#### Scenario: Message sent without a reply reference

- **WHEN** a human message is sent to a thread with no reply reference
- **THEN** the message is accepted, is stored with no reference, and the agent is woken exactly as it is for a message sent before this capability existed

#### Scenario: Replying to a message that is itself a reply

- **WHEN** a human message references a message that carries its own reply reference
- **THEN** the new message is stored with a reference to that message only, and no earlier message in the chain is referenced

#### Scenario: The conductor's own replies carry no reply reference

- **WHEN** the conductor sends an outbound message asking for no reply target, and the turn was not woken by exactly one human message
- **THEN** that message has no reply reference, exactly as before the conductor could carry one

### Requirement: A reply reference that does not name a message of the same thread is rejected

A message carrying a reply reference that does not name an existing message of the message's own thread
SHALL be rejected with an error, and SHALL NOT be stored and, for an inbound message, SHALL NOT wake the
agent. A message belonging to a different thread SHALL be treated the same as one that does not exist, so
a reference can never cross a thread boundary. This applies equally to an inbound human message and an
outbound conductor message.

#### Scenario: Reference to a message that does not exist

- **WHEN** a human message is sent with a reply reference that matches no message
- **THEN** the request fails with an error, no message is stored in the thread, and no wake is enqueued

#### Scenario: Reference to a message in another thread

- **WHEN** a human message is sent with a reply reference naming a message that exists but belongs to a different thread
- **THEN** the request fails in the same way as for a message that does not exist

#### Scenario: The conductor names an invalid or cross-thread reply target

- **WHEN** the conductor sends an outbound message with a reply target that does not exist in the message's own thread
- **THEN** the request fails with an error and no message is stored, whether the target does not exist at all or belongs to another thread

### Requirement: A sent message shows the message it replied to

A human message shown in the conductor chat SHALL display a quote of the message it replied to, so the
human can see afterwards what was being answered. The quote SHALL survive reloading the chat. A message
sent with no reply reference SHALL display no quote and SHALL render as it did before this capability
existed. A conductor message carrying a reply reference SHALL display the same quote, in the same way.

#### Scenario: A message sent as a reply

- **WHEN** a human message that carried a reply reference is rendered in the chat
- **THEN** it is shown with a quote of the referenced message above its own text

#### Scenario: A message sent without a reply

- **WHEN** a human message that carried no reply reference is rendered in the chat
- **THEN** no quote is shown on it

#### Scenario: Reloading the chat

- **WHEN** the chat is reloaded after a reply was sent
- **THEN** that message is still shown with its quote, without the referenced message having to be on screen

#### Scenario: A conductor message sent as a reply

- **WHEN** a conductor message that carries a reply reference is rendered in the chat
- **THEN** it is shown with the same quote treatment as a human reply, and a conductor message with no reply reference renders with no quote

## ADDED Requirements

### Requirement: The conductor can send a message with an explicit reply reference

`ac_human_send` SHALL accept an optional reply target naming one message of the thread the outbound
message is sent to. When given, the outbound message SHALL be stored with a reference to that message,
validated and excerpted the same way an inbound human reply is: one path, not a second implementation.

#### Scenario: The conductor answers a specific message

- **WHEN** the conductor sends a message naming an earlier message of the same thread as its reply target
- **THEN** the outbound message is stored with a reference to that message and, when the thread's messages are read, carries the same bounded excerpt an inbound reply would

### Requirement: The reply target defaults to the message that woke the turn

When `ac_human_send` is called with no reply target specified at all, and the run's turn was woken by
exactly one human message, the outbound message's reply target SHALL default to that message. This
default SHALL NOT apply when the turn was woken by zero human messages or by more than one, since there
is then no single message the reply could unambiguously answer.

Explicitly asking for no reply target SHALL be honored regardless of how many human messages woke the
turn, so the conductor can send a message unrelated to what woke it — for example relaying a landed
ticket — in the same turn as answering the message that woke it.

#### Scenario: A turn woken by exactly one human message

- **WHEN** the conductor sends a message with no reply target specified, and the run's turn was woken by exactly one human message
- **THEN** the outbound message is stored with a reference to that message

#### Scenario: Explicitly opting out of the default

- **WHEN** the conductor sends a message explicitly asking for no reply target, in a turn that was woken by exactly one human message
- **THEN** the outbound message is stored with no reply reference

#### Scenario: A turn woken by more than one human message

- **WHEN** the conductor sends a message with no reply target specified, and the run's turn was woken by more than one human message
- **THEN** the outbound message is stored with no reply reference

#### Scenario: A turn not woken by any human message

- **WHEN** the conductor sends a message with no reply target specified, and the run's turn was not woken by a human message at all
- **THEN** the outbound message is stored with no reply reference
