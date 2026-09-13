# conductor-chat/message-jump Specification

## Purpose
Defines what happens when the human selects a specific past message to view — from a search result
or otherwise — including how the surrounding conversation loads, how the message is highlighted, and
how the chat returns to following new messages afterward.

## Requirements

### Requirement: Selecting a result jumps to that message in context

Selecting a message that is not in the currently loaded history SHALL load the history surrounding
that message, scroll it into view, and briefly highlight it — regardless of how far back in the
thread it is.

#### Scenario: Jumping to a message far outside the loaded window

- **WHEN** the human selects a message that is older than everything currently loaded in the chat
- **THEN** the chat loads the messages around it, scrolls to it, and highlights it briefly

#### Scenario: Jumping to a message already loaded

- **WHEN** the human selects a message that is already present in the currently loaded history
- **THEN** the chat scrolls to it and highlights it briefly without discarding what is loaded

### Requirement: Returning to the live conversation is one action

While viewing a jumped-to message, a single action SHALL return the chat to following the latest
message, exactly as if no jump had happened.

#### Scenario: Returning to the latest message

- **WHEN** the human is viewing a jumped-to message and takes the "back to latest" action
- **THEN** the chat returns to showing the latest messages, scrolled to the bottom

### Requirement: New messages behave normally after a jump

Once the chat has returned to the live conversation after a jump, messages arriving afterward SHALL
behave exactly as they do when no jump has ever happened — the same follow-the-bottom and
stay-in-place behavior the chat already provides.

#### Scenario: A message arrives after returning from a jump

- **WHEN** the human has returned to the live conversation after jumping to an older message, and a
  new message arrives
- **THEN** the chat follows it to the bottom the same way it would have if no jump had occurred
