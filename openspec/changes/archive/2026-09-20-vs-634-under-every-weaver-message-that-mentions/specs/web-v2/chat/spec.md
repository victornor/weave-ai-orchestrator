## ADDED Requirements

### Requirement: Weaver messages carry a live ticket-status strip

The V2 Chat conversation SHALL render, under each weaver message that references tickets, the compact
ticket-status strip specified by `conductor-chat/dispatch-labels`: one wrapped row of chips, at most
six with a `+N more` chip that expands the rest in place. The strip SHALL render nothing, and reserve
no height, under a message that references no ticket.

Each chip SHALL carry the ticket identifier, the acting name and the ticket's current status with the
existing status glyph and hue, and SHALL activate through the same shared ticket link handler the
message's inline identifiers use, so a chip opens the ticket modal on desktop and navigates on phone
with no second handler written for it.

The strip SHALL be part of the message's block: a chip appearing or changing status under the newest
message SHALL NOT pull a reader who has scrolled up back to the bottom, and SHALL NOT cause a layout
jump. The strip SHALL be rendered wherever the weaver conversation is shown through the shared
conversation component — the Chat screen and each pane of the global chats — and SHALL NOT be
rendered in a planner chat or a worker/session transcript.

#### Scenario: A message that filed a ticket and a message that only mentions tickets

- **WHEN** the conversation shows one weaver message that filed a ticket and another that merely names two existing tickets
- **THEN** each of those messages carries its own strip under it, and a weaver message referencing no ticket carries none

#### Scenario: A chip opens the same modal an identifier does

- **WHEN** the human activates a chip in the strip on a desktop viewport
- **THEN** the ticket modal opens, exactly as activating the identifier in the message text does

#### Scenario: A chip on phone navigates

- **WHEN** the human activates a chip on a phone viewport
- **THEN** the ticket page opens, as it does for an identifier in the text

#### Scenario: No strip, no reserved height

- **WHEN** a weaver message references no ticket
- **THEN** no empty strip or spacer is rendered under it

#### Scenario: A chip changing status does not yank a reader who scrolled up

- **WHEN** the human has scrolled up and a chip under a message changes its status
- **THEN** the view stays where it is and no layout jump occurs

#### Scenario: The global chats show the strip, the planner chat does not

- **WHEN** a workspace is shown as a pane of the global chats, and a plan tab's planner chat is shown
- **THEN** the weaver conversation in the pane carries the strip and the planner chat does not
