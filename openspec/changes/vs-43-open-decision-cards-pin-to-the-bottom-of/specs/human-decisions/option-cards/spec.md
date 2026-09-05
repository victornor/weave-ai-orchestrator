## ADDED Requirements

### Requirement: An open decision waits pinned to the bottom of the conductor chat

The conductor chat SHALL render every decision that is open and awaiting the human in a region pinned to the bottom of the chat, between the message list and the composer, whatever turn raised it and wherever in the conversation that turn's message sits. An open decision SHALL be visible there without scrolling, and SHALL NOT also be rendered as an item of the message list.

Several open decisions SHALL be stacked oldest first. The pinned region SHALL be bounded to a part of the viewport and SHALL scroll within itself when its contents exceed that bound, so that the composer is never displaced.

A pinned card SHALL carry everything the card carries anywhere else, including who is asking, and SHALL be answerable in place.

The pinned region SHALL be outside the scrolling message list, so that it does not change how the list follows its own bottom, how the human is returned to the bottom of the list, or how earlier history is loaded.

What is pinned SHALL be derived from the decisions' own state, so that reloading the chat pins the same decisions, and a decision raised during a turn that is still streaming SHALL be pinned as soon as it exists rather than waiting for the turn to end.

#### Scenario: The conversation moves on

- **WHEN** a decision is open and further messages have arrived since it was raised
- **THEN** its card is in the pinned region at the bottom of the chat, and is not rendered in the message list

#### Scenario: Several open decisions

- **WHEN** more than one decision is open at the same time
- **THEN** all of them are in the pinned region, the one raised first at the top

#### Scenario: More open decisions than fit

- **WHEN** the open decisions would take more than the region's share of the viewport
- **THEN** the region scrolls within itself and the composer stays on screen

#### Scenario: A decision raised in the turn in flight

- **WHEN** the conductor raises a decision during a turn that is still streaming
- **THEN** its card is pinned at once, attributed to the conductor

#### Scenario: Reload

- **WHEN** the human reloads the chat while a decision is open
- **THEN** the same decision is pinned, in the state it is actually in

#### Scenario: The message list keeps its own behavior

- **WHEN** the pinned region is on screen
- **THEN** the message list still follows its newest message while the human is at the bottom, and still offers the way back to the bottom when they are not

## MODIFIED Requirements

### Requirement: An answered card stays in place and becomes inert

Once a decision has been answered, its card SHALL leave the pinned region and SHALL be rendered in the conversation at the point it was raised — directly after the conductor message of the turn that raised it — rather than disappearing. It SHALL show what was answered: the label of the option that was chosen, or the words that were written, together with when it was answered. It SHALL keep that position as the conversation grows.

This SHALL hold however the answer was given: from the pinned card, or from anywhere else the same decision is offered.

An answered card SHALL offer no way to answer again: its options SHALL NOT be selectable and its send action SHALL NOT be offered.

An answered decision that cannot be attributed to a message in the open conversation SHALL NOT be rendered in the conversation.

Positions SHALL be derived from durable records, so that reloading the chat reproduces the same answered cards in the same positions.

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

## REMOVED Requirements

### Requirement: A conductor's question sits where it was asked

**Reason**: An open question anchored to the message that raised it is carried out of the viewport by the conversation, which is exactly the failure this change fixes; an open decision now waits in the pinned region instead. The part of this requirement that survives — the answered record sitting at the anchor, and positions derived from durable records — is now carried by "An answered card stays in place and becomes inert".

**Migration**: None. No stored data, no API and no client contract depended on where the card was rendered; both surfaces read the same decisions.
