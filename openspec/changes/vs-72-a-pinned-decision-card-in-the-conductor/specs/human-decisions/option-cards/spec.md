## ADDED Requirements

### Requirement: An open decision can be hidden from the chat without answering it

The human SHALL be able to take an open decision's card out of the conductor chat's pinned region
without answering it. Hiding SHALL be offered on the card itself, as an action distinct from every
action that answers, and SHALL NOT be offered on a card that is a record rather than a prompt.

Hiding SHALL NOT change the decision: it stays open, it stays owned by the human, no answer is
recorded, and the asker is not woken. It SHALL remain listed in `Needs you`, answerable there
exactly as any other open decision, and the inert record of the decision once it is answered SHALL
appear in the conversation in the position it would have had if it had never been hidden.

Hiding SHALL be remembered for the device it was done on, so that reloading the chat does not bring
a hidden card back, and SHALL NOT change what any other device shows.

While at least one open decision is hidden, the pinned region SHALL say how many, and SHALL offer a
single action that shows all of them again. `Needs you` SHALL mark a decision that is hidden from
the chat and SHALL offer that decision alone back to the chat.

A hidden decision SHALL return to the pinned region on its own when what it is asking changes: when
the decision itself is edited, when a comment arrives on the ticket it concerns, and when it is
close to expiring. A superseded decision is not open and its replacement is a different decision, so
the replacement SHALL be pinned.

#### Scenario: Hiding a card

- **WHEN** the human hides an open decision's card from the chat
- **THEN** the card leaves the pinned region, the decision is still open and unanswered, and it is still waiting in `Needs you`

#### Scenario: Hidden across a reload

- **WHEN** the human reloads the chat after hiding a decision
- **THEN** the decision is still open and still not in the pinned region

#### Scenario: How many are hidden

- **WHEN** one or more open decisions are hidden from the chat
- **THEN** the pinned region says how many, and one action shows all of them again

#### Scenario: Needs you says what the chat is not showing

- **WHEN** the human opens `Needs you` while a decision is hidden from the chat
- **THEN** that decision is listed with the rest, marked as hidden from the chat, and can be shown in the chat again from there

#### Scenario: Answering a hidden decision

- **WHEN** the human answers a hidden decision from `Needs you`
- **THEN** the answer is recorded exactly as an answer from a pinned card, and the answered record appears in the conversation after the message of the turn that raised it

#### Scenario: The decision is edited

- **WHEN** a decision that was hidden is changed — its question, its context, its recommendation or its options
- **THEN** its card is in the pinned region again

#### Scenario: A comment on its ticket

- **WHEN** a comment arrives on the ticket a hidden decision concerns
- **THEN** its card is in the pinned region again

#### Scenario: About to expire

- **WHEN** a hidden decision is close to the time it expires
- **THEN** its card is in the pinned region again

#### Scenario: An answered card offers no hiding

- **WHEN** a card shows a decision that is no longer open
- **THEN** it offers no way to hide it

## MODIFIED Requirements

### Requirement: An open decision waits pinned to the bottom of the conductor chat

The conductor chat SHALL render every decision that is open and awaiting the human in a region
pinned to the bottom of the chat, between the message list and the composer, whatever turn raised it
and wherever in the conversation that turn's message sits, except for a decision the human has
hidden from the chat on this device. An open decision that has not been hidden SHALL be visible
there without scrolling, and SHALL NOT also be rendered as an item of the message list.

Several open decisions SHALL be stacked oldest first. The pinned region SHALL be bounded to a part
of the viewport and SHALL scroll within itself when its contents exceed that bound, so that the
composer is never displaced.

A pinned card SHALL carry everything the card carries anywhere else, including who is asking, and
SHALL be answerable in place.

The pinned region SHALL be outside the scrolling message list, so that it does not change how the
list follows its own bottom, how the human is returned to the bottom of the list, or how earlier
history is loaded.

What is pinned SHALL be derived from the decisions' own state and from what this device has hidden,
so that reloading the chat pins the same decisions, and a decision raised during a turn that is
still streaming SHALL be pinned as soon as it exists rather than waiting for the turn to end.

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
