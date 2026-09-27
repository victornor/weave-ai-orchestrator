## MODIFIED Requirements

### Requirement: Selecting a result jumps to that message in context

Selecting a message that is not in the currently loaded history SHALL load the history surrounding
that message into the same scrollable conversation the human otherwise reads, scroll it into view, and
briefly highlight it — regardless of how far back in the thread it is. The conversation SHALL remain
freely scrollable in both directions from that position: scrolling up SHALL keep loading older messages
and scrolling down SHALL keep loading newer messages through to the latest message in the thread. There
SHALL be no point past which the conversation cannot be scrolled further in either direction while more
messages exist on that side.

#### Scenario: Jumping to a message far outside the loaded window

- **WHEN** the human selects a message that is older than everything currently loaded in the chat
- **THEN** the chat loads the messages around it into the same scrollable conversation, scrolls to it,
  and highlights it briefly

#### Scenario: Jumping to a message already loaded

- **WHEN** the human selects a message that is already present in the currently loaded history
- **THEN** the chat scrolls to it and highlights it briefly without discarding what is loaded

#### Scenario: Scrolling up from a jumped-to message keeps loading history

- **WHEN** the human scrolls up from a message they jumped to, and older messages exist beyond what is
  loaded
- **THEN** those older messages load and appear, with no dead end

#### Scenario: Scrolling down from a jumped-to message reaches the latest message

- **WHEN** the human scrolls down from a message they jumped to
- **THEN** newer messages keep loading, without a separate action, until the latest message in the
  thread is reached, and the composer and any live turn keep working the whole time

### Requirement: Returning to the live conversation is one action

A "jump to latest" affordance SHALL remain available while viewing a jumped-to message, as a
convenience that returns the chat to following the newest message. It SHALL NOT be the only way to
reach the latest message: scrolling down from the jumped-to position, per the requirement above, SHALL
also reach it.

#### Scenario: Returning to the latest message

- **WHEN** the human is viewing a jumped-to message and takes the "jump to latest" action
- **THEN** the chat returns to showing the latest messages, scrolled to the bottom

#### Scenario: Reaching the latest message by scrolling instead

- **WHEN** the human is viewing a jumped-to message and scrolls down all the way through the
  conversation's newer messages, without taking the "jump to latest" action
- **THEN** the chat reaches and shows the latest message just the same

### Requirement: New messages behave normally after a jump

Once the chat has returned to the live conversation after a jump — by the convenience action or by
scrolling all the way down — messages arriving afterward SHALL behave exactly as they do when no jump
has ever happened — the same follow-the-bottom and stay-in-place behavior the chat already provides.

#### Scenario: A message arrives after returning from a jump

- **WHEN** the human has returned to the live conversation after jumping to an older message, and a
  new message arrives
- **THEN** the chat follows it to the bottom the same way it would have if no jump had occurred

#### Scenario: A message arrives while still scrolled back near a jumped-to position

- **WHEN** the human is still scrolled away from the bottom, viewing history around a jumped-to
  message, and a new message arrives at the live tail
- **THEN** the chat does not yank the view away from where the human is reading, the same as any other
  time a new message arrives while scrolled up
