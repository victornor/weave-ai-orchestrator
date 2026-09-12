## MODIFIED Requirements

### Requirement: An answered card stays in place and becomes inert

Once a decision has been answered, its card SHALL leave the pinned region and SHALL be rendered in
the conversation at the point it was raised — directly after the conductor message of the turn that
raised it — rather than disappearing. It SHALL show what was answered: the label of the option that
was chosen, or the words that were written, together with when it was answered. It SHALL keep that
position as the conversation grows.

When the answer was recorded by the weaver from the human's own message rather than given by the
human directly, the card SHALL show that: it SHALL say the words are the human's, that the weaver
recorded them from the human's message, and it SHALL NOT present the answer in a way that is
indistinguishable from the human's own tap. This SHALL hold everywhere the answered decision is
shown, including the card in the conductor chat and in Needs you and the shared card model the TUI
and CLI render.

This SHALL hold however the answer was given: from the pinned card, from anywhere else the same
decision is offered, or recorded by the weaver from a message the human sent.

An answered card SHALL offer no way to answer again: its options SHALL NOT be selectable and its
send action SHALL NOT be offered.

An answered decision that cannot be attributed to a message in the open conversation SHALL NOT be
rendered in the conversation.

Positions SHALL be derived from durable records, so that reloading the chat reproduces the same
answered cards in the same positions.

#### Scenario: After answering

- **WHEN** the human answers a question from its pinned card in the chat
- **THEN** the card leaves the pinned region, and the answer it was given is shown in the conversation after the message of the turn that raised it

#### Scenario: Answered somewhere else

- **WHEN** the human answers the same decision outside the chat
- **THEN** the chat stops pinning it and shows the same answered record in the conversation

#### Scenario: The card cannot be answered twice

- **WHEN** a card shows an answered decision
- **THEN** it offers no way to select an option or send an answer

#### Scenario: The history survives a reload

- **WHEN** the human reloads the chat after answering
- **THEN** the answered card is in its position in the conversation, still showing the answer

#### Scenario: A relayed answer is shown as relayed

- **WHEN** a card shows a decision whose answer the weaver recorded from the human's message
- **THEN** the card shows the human's words as the answer and states that the weaver recorded them
  from the human's message, rather than showing them as the human's own tap

#### Scenario: A directly answered card is unchanged

- **WHEN** a card shows a decision the human answered directly
- **THEN** it shows the answer exactly as it did before a relayed-answer path existed, with no relay
  statement
