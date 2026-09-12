## MODIFIED Requirements

### Requirement: An answered card stays in place and becomes inert

Once a decision has been answered, its card SHALL leave the pinned region and SHALL be rendered in
the conversation where it was asked — directly after the message that carried its card, or, when the
decision was pushed to the conversation with no card message, directly after the conductor message
of the turn that raised it — rather than disappearing. It SHALL show what was answered: the label of
the option that was chosen, or the words that were written, together with when it was answered. It
SHALL keep that position as the conversation grows.

When the answer was recorded by the weaver from the human's own message rather than given by the
human directly, the card SHALL show that: it SHALL say the words are the human's, that the weaver
recorded them from the human's message, and it SHALL NOT present the answer in a way that is
indistinguishable from the human's own tap. This SHALL hold everywhere the answered decision is
shown, including the card in the conductor chat and in Needs you and the shared card model the TUI
and CLI render.

This SHALL hold however the answer was given: from the pinned card, from the inline card, from
anywhere else the same decision is offered, or recorded by the weaver from a message the human sent.

An answered card SHALL offer no way to answer again: its options SHALL NOT be selectable and its
send action SHALL NOT be offered.

An answered decision SHALL be rendered in the conversation whenever the message carrying its card,
or the message of the turn that raised it, is in the open conversation. A decision with neither is
not part of the conversation and SHALL NOT be rendered there; while it is still open the pinned
region still surfaces it.

Positions SHALL be derived from durable records, so that reloading the chat reproduces the same
answered cards in the same positions.

#### Scenario: After answering

- **WHEN** the human answers a question from its pinned card in the chat
- **THEN** the card leaves the pinned region, and the answer it was given is shown in the conversation after the message it was pushed to

#### Scenario: Answered somewhere else

- **WHEN** the human answers the same decision outside the chat
- **THEN** the chat stops pinning it and shows the same answered record in the conversation

#### Scenario: Answered from an inline card

- **WHEN** the human answers the decision from its card in the message list
- **THEN** the pinned region stops pinning it and the inline card shows the answer that was given

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

#### Scenario: An answered decision whose raising run left no message

- **WHEN** a decision is answered and the run that raised it left no message in the thread, but the message that carried the decision's card is in the conversation
- **THEN** the answered record is rendered after that card message, not dropped

#### Scenario: A decision with no message at all

- **WHEN** an answered decision is attributed to neither a card message nor the message of the turn that raised it
- **THEN** it is not rendered in the conversation

### Requirement: An open decision waits pinned to the bottom of the conductor chat

The conductor chat SHALL render every decision that is open and awaiting the human in a region
pinned to the bottom of the chat, between the message list and the composer, whatever turn raised it
and wherever in the conversation that turn's message sits, except for a decision the human has
hidden from the chat on this device. An open decision that has not been hidden SHALL be reachable
there without scrolling: an open decision with no inline card of its own SHALL be rendered as a card
in the region, and an open decision whose card is rendered in the message list SHALL be rendered in
the region only while that inline card is not on screen, so a card scrolled out of view is still one
gesture away and the same decision is never read as two cards at once.

Several open decisions SHALL be stacked oldest first. The pinned region SHALL be bounded to a part
of the viewport and SHALL scroll within itself when its contents exceed that bound, so that the
composer is never displaced. That bound SHALL be the height the human has chosen for the region when
they have chosen one, and otherwise a share of the viewport chosen by the app.

A pinned card SHALL carry everything the card carries anywhere else, including who is asking, and
SHALL be answerable in place.

The pinned region SHALL be outside the scrolling message list, so that it does not change how the
list follows its own bottom, how the human is returned to the bottom of the list, or how earlier
history is loaded.

What is pinned SHALL be derived from the decisions' own state, from what is currently on screen in
the message list, and from what this device has hidden, so that reloading the chat pins the same
decisions, and a decision raised during a turn that is still streaming SHALL be pinned as soon as it
exists rather than waiting for the turn to end.

#### Scenario: The conversation moves on

- **WHEN** a decision is open and further messages have arrived since it was raised, and its inline card is not on screen
- **THEN** its card is in the pinned region at the bottom of the chat

#### Scenario: The inline card is on screen

- **WHEN** an open decision's inline card is visible in the message list
- **THEN** that decision is not also rendered as a card in the pinned region

#### Scenario: The inline card scrolls out of view

- **WHEN** the human scrolls an open decision's inline card out of the message list
- **THEN** its card is rendered in the pinned region again, so it is not out of reach

#### Scenario: An open decision with no inline card

- **WHEN** an open decision has no message carrying its card in the open conversation
- **THEN** its card is rendered in the pinned region

#### Scenario: Several open decisions

- **WHEN** more than one decision is open at the same time
- **THEN** all of them are reachable from the pinned region, the one raised first at the top

#### Scenario: More open decisions than fit

- **WHEN** the open decisions would take more than the region's share of the viewport
- **THEN** the region scrolls within itself and the composer stays on screen

#### Scenario: A decision raised in the turn in flight

- **WHEN** the conductor raises a decision during a turn that is still streaming
- **THEN** its card is pinned at once when it has no inline card on screen, attributed to the conductor

#### Scenario: Reload

- **WHEN** the human reloads the chat while a decision is open
- **THEN** the same decision is reachable in the state it is actually in

#### Scenario: The message list keeps its own behavior

- **WHEN** the pinned region is on screen
- **THEN** the message list still follows its newest message while the human is at the bottom, and still offers the way back to the bottom when they are not

## ADDED Requirements

### Requirement: A decision pushed to the conversation renders answerable where it was asked

A message whose `parts` carry a decision card SHALL render that card in the conversation as a card,
not as its text fallback, showing the question, the context, and every option with the
recommendation marked. When the decision is open the card SHALL be answerable in place; when it has
been answered the card SHALL be the inert record of what was answered. Answering from it SHALL
record the answer against the decision the card's `ref` names, through the same answer path every
other surface uses, so the answer is recorded once and every surface then shows it as answered.

The message's plain-text fallback SHALL NOT also be rendered for a card the chat has shown, so the
question never appears once as a card and again as prose. A card part whose decision is not loaded
SHALL degrade to its text rather than render nothing.

#### Scenario: Options are pressable inline

- **WHEN** an open decision's card message is rendered in the chat
- **THEN** its options are selectable, the recommended one is marked, and no adjacent prose copy of the question is also shown

#### Scenario: Answering from the inline card

- **WHEN** the human selects an option on an inline card and sends it
- **THEN** the decision is answered with that option, and the same decision reads as answered wherever else it is shown

#### Scenario: Free text inline

- **WHEN** an inline card permits an answer in the human's own words
- **THEN** the card offers that alternative and sending it answers the decision with those words

#### Scenario: An inline card can be hidden

- **WHEN** the human hides an open inline card from the chat
- **THEN** it leaves the message list without being answered, the decision stays open in `Needs you`, and the hidden count still offers to show it again

#### Scenario: Offline or unreachable answering

- **WHEN** the chat is offline or the send cannot reach the daemon and the human answers a non-secret inline card
- **THEN** the answer is queued exactly as an answer from the pinned card is

#### Scenario: A secret-carrying inline card

- **WHEN** an inline card collects a secret and the chat is offline
- **THEN** the answer is never queued or stored on the device, and the human is told it was not sent

#### Scenario: A card part with no loaded decision

- **WHEN** a card message's decision is not among the decisions the chat loaded
- **THEN** the card's text is rendered in its place, and nothing is lost
