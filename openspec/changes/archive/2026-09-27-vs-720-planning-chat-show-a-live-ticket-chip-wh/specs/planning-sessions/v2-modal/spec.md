## MODIFIED Requirements

### Requirement: A plan tab's conversation renders exactly like the weaver chat

A plan tab's conversation SHALL render through the same message list, per-turn turn summary, live
working trace, markdown, attachment rows, stick-to-bottom follow and ticket reference strip as the
weaver chat, differing only in its actor name ("Planner") and in the weaver-only affordances it
omits — inline decision cards, the reply control and the unattributed-worker row. Its composer SHALL
carry the same attach, dictate and send controls as the weaver chat and SHALL send to the plan's
planner; it SHALL NOT offer the chat's project scope selector, being bound to the plan's own project.

#### Scenario: The plan conversation matches the weaver chat

- **WHEN** the planning agent's turn produced a message with tool calls, tokens and a context figure
- **THEN** the plan tab renders the same message list, turn-summary line and working trace the weaver
  chat would for the same turn, naming the actor "Planner"

#### Scenario: Attachments behave identically

- **WHEN** captain attaches an image or text file in a plan tab's composer and sends
- **THEN** it is uploaded with the message and rendered as an attachment row exactly as the weaver
  chat renders one

#### Scenario: The plan composer has no project selector

- **WHEN** a plan tab's composer is shown
- **THEN** it offers attach, dictate and send, and does not offer the chat's project scope selector

#### Scenario: The plan composer sends to the planner

- **WHEN** captain sends a message from a plan tab's composer
- **THEN** it is posted to that plan's planner conversation

#### Scenario: Decision cards, the reply control and the unattributed-worker row stay absent

- **WHEN** the plan tab's conversation renders a planner turn
- **THEN** it shows no inline decision card, no reply-to-this-message control and no row of
  unattributed live workers below the conversation, because the planner never raises a decision and
  never leaves a dispatch this tab cannot chip under a message

## ADDED Requirements

### Requirement: A dispatched scout shows a live ticket chip in the planning conversation

The plan tab's conversation SHALL render the ticket reference strip under a planner message exactly
as `conductor-chat/dispatch-labels` specifies for the weaver chat — the same `V2TicketStrip` chip,
carrying the ticket's identifier and live status, opening the ticket through the chat's shared link
handler, and expanding in place to the ticket's live activity feed behind its chevron — reusing that
one component rather than a second implementation.

A chip for a scout the planner dispatched SHALL be derived from the draft's link to the ticket it
created, not solely from the planner's message text, so it renders even when the planner's reply
names no identifier. A ticket identifier the planner's reply does name SHALL render a strip the same
way a weaver message's does. The strip SHALL survive reopening the plan, deriving from the same
durable records the weaver chat's strip does.

#### Scenario: A dispatch renders a chip even when the reply omits the identifier

- **WHEN** the planner dispatches a scout draft and replies without naming the created ticket
- **THEN** a chip for that ticket still renders under the reply, showing its identifier and live
  status

#### Scenario: A planner message naming a ticket gets a strip

- **WHEN** a planner message's text names a ticket identifier that resolves to a real ticket
- **THEN** a strip renders under that message the same way it would under a weaver message naming
  the same identifier

#### Scenario: The chip opens the ticket and expands to the live feed

- **WHEN** captain activates a chip's body, or its chevron, in the plan tab's conversation
- **THEN** activating the body opens the ticket through the chat's shared link handler, and
  activating the chevron expands an inline panel showing the ticket's live activity feed, exactly as
  in the weaver chat

#### Scenario: The chip survives reopening the plan

- **WHEN** captain closes the plan tab and reopens it after a scout has been dispatched
- **THEN** the same chip renders in the same position, showing the ticket's current status
