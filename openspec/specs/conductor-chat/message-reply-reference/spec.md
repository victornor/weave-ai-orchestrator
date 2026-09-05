# conductor-chat/message-reply-reference Specification

## Purpose
Defines how a human message answers one specific earlier message in the same thread: how the human picks
it in the conductor chat, how the reference is stored with the message, how the quoted message is shown
back, and how the reference reaches the conductor as structured context — so a short answer like "yes, do
it" never has to be matched to its question by ordering.

## Requirements

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

- **WHEN** the conductor sends an outbound message to the thread
- **THEN** that message has no reply reference

### Requirement: A reply reference that does not name a message of the same thread is rejected

A message carrying a reply reference that does not name an existing message of the message's own thread
SHALL be rejected with an error, and SHALL NOT be stored and SHALL NOT wake the agent. A message belonging
to a different thread SHALL be treated the same as one that does not exist, so a reference can never cross
a thread boundary.

#### Scenario: Reference to a message that does not exist

- **WHEN** a human message is sent with a reply reference that matches no message
- **THEN** the request fails with an error, no message is stored in the thread, and no wake is enqueued

#### Scenario: Reference to a message in another thread

- **WHEN** a human message is sent with a reply reference naming a message that exists but belongs to a different thread
- **THEN** the request fails in the same way as for a message that does not exist

### Requirement: Reading a message returns a bounded excerpt of the message it replies to

Whenever a thread's messages are read, a message that carries a reply reference SHALL be returned with a
bounded excerpt of the referenced message's body in addition to the reference itself, so the quote can be
shown without a further read and without the referenced message having to be in the same result.

The excerpt SHALL be derived from the referenced message at read time, so it is never a stale copy. A
message that carries no reply reference SHALL be returned with no excerpt.

#### Scenario: Reading a message that replies to another

- **WHEN** the messages of a thread are read and one of them carries a reply reference
- **THEN** that message is returned with both the reference and an excerpt of the referenced message's body

#### Scenario: The referenced message is outside the requested page

- **WHEN** the messages of a thread are read with a limit or a cursor that excludes the referenced message
- **THEN** the replying message is still returned with the reference and the excerpt

#### Scenario: Reading a message that replies to nothing

- **WHEN** the messages of a thread are read and a message carries no reply reference
- **THEN** that message is returned with no reference and no excerpt, exactly as before this capability existed

### Requirement: The conductor receives the reply reference as structured context

The wake raised by an inbound human message SHALL carry the message's reply reference in its payload,
alongside the thread, message and body it already carries. The payload SHALL identify the referenced
message both by its identifier and by a bounded excerpt of its text, so the conductor can map the answer
to what it answers without a further lookup.

When the message carries no reply reference, the payload SHALL say so explicitly rather than omitting the
information ambiguously, and every other field SHALL be unchanged.

#### Scenario: The conductor reads its inbox after a reply

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried a reply reference
- **THEN** the message entry's payload identifies the referenced message by identifier and by an excerpt of its text, in addition to the thread, message and body

#### Scenario: The conductor reads its inbox after a message with no reply

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried no reply reference
- **THEN** the message entry's payload reports no referenced message, and the thread, message and body are as they were before this capability existed

#### Scenario: A reply on a thread bound to a ticket

- **WHEN** a human message carrying a reply reference arrives on a thread that is bound to a ticket
- **THEN** it lands as a comment on that ticket and wakes that ticket's worker exactly as before, and the reference is still stored on the message

### Requirement: The conductor chat offers a reply control on each conductor message

The web conductor chat SHALL offer a reply control on every conductor message in the conversation.
Choosing it SHALL show a compact quote of that message next to the input, identifying which message the
next message will answer.

The quote SHALL be dismissable before sending, and dismissing it SHALL return the composer to sending with
no reply reference. Choosing the control on a different message while a quote is shown SHALL replace the
quote rather than accumulate a second one.

#### Scenario: Choosing to reply to a conductor message

- **WHEN** the human uses the reply control on a conductor message
- **THEN** a compact quote of that message is shown next to the input

#### Scenario: Dismissing the quote before sending

- **WHEN** the human dismisses the quote and then sends a message
- **THEN** the message is sent with no reply reference

#### Scenario: Choosing a different message to reply to

- **WHEN** the human uses the reply control on a second conductor message while a quote is already shown
- **THEN** the quote is replaced by the second message, and only that message is referenced when the message is sent

#### Scenario: A conversation with no conductor messages yet

- **WHEN** the chat is open on a thread that has no conductor messages
- **THEN** no reply control is offered and sending a message still works

### Requirement: Sending carries the reply reference, online and offline

Sending a message while a quote is shown SHALL carry a reference to the quoted message. After the message
is sent, the quote SHALL be cleared, so the next message is not silently attributed to the same question.

A message sent while the app is offline SHALL retain the reference in the queue and SHALL be sent with it
when the queue is flushed.

#### Scenario: Sending with a quote shown

- **WHEN** the human sends a message while a conductor message is quoted
- **THEN** the message is sent carrying a reference to that message

#### Scenario: The composer after a reply is sent

- **WHEN** a message carrying a reply reference has been sent
- **THEN** no quote is shown next to the input, and the next message sent carries no reference unless the human chooses one again

#### Scenario: Sending a reply while offline

- **WHEN** the human sends a message with a quote shown while the app is offline
- **THEN** the queued message retains the reply reference and is sent with it when the queue is flushed

### Requirement: A sent message shows the message it replied to

A human message shown in the conductor chat SHALL display a quote of the message it replied to, so the
human can see afterwards what was being answered. The quote SHALL survive reloading the chat. A message
sent with no reply reference SHALL display no quote and SHALL render as it did before this capability
existed.

#### Scenario: A message sent as a reply

- **WHEN** a human message that carried a reply reference is rendered in the chat
- **THEN** it is shown with a quote of the referenced message above its own text

#### Scenario: A message sent without a reply

- **WHEN** a human message that carried no reply reference is rendered in the chat
- **THEN** no quote is shown on it

#### Scenario: Reloading the chat

- **WHEN** the chat is reloaded after a reply was sent
- **THEN** that message is still shown with its quote, without the referenced message having to be on screen
