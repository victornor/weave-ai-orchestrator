## MODIFIED Requirements

### Requirement: An open decision waits pinned to the bottom of the conductor chat

The conductor chat SHALL render every decision that is open and awaiting the human in a region
pinned to the bottom of the chat, between the message list and the composer, whatever turn raised it
and wherever in the conversation that turn's message sits, except for a decision the human has
hidden from the chat on this device. An open decision that has not been hidden SHALL be visible
there without scrolling, and SHALL NOT also be rendered as an item of the message list.

Several open decisions SHALL be stacked oldest first. The pinned region SHALL be bounded to a part
of the viewport and SHALL scroll within itself when its contents exceed that bound, so that the
composer is never displaced. That bound SHALL be the height the human has chosen for the region when
they have chosen one, and otherwise a share of the viewport chosen by the app.

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

## ADDED Requirements

### Requirement: The human sets how tall the pinned region is

The pinned region's top edge SHALL be a handle the human can drag to change how tall the region is.
Dragging the handle towards the top of the screen SHALL make the region taller and the message list
correspondingly shorter; dragging it towards the bottom SHALL do the reverse. The handle SHALL be
usable with a mouse, a pen and a finger, and dragging it with a finger SHALL NOT scroll anything.

The height SHALL be clamped. It SHALL never be so small that the topmost card's heading and the row
of actions that answers it are not both on screen, and never so large that the composer and some of
the conversation above the region are not both still on screen. The clamps SHALL be derived from the
height the app is actually being shown in rather than from the page, so that they tighten on their
own when an on-screen keyboard takes part of the viewport, and a height chosen before the keyboard
opened SHALL be brought back within them for as long as it is open.

Until the human has chosen a height, the region SHALL be exactly as tall as its contents up to the
share of the viewport the app chooses, which is what it is today. Once they have chosen one, the
region SHALL be that tall whether its contents need it or not, and SHALL scroll within itself when
they need more.

The chosen height SHALL be remembered for the device it was chosen on: it SHALL survive reloading
the chat, leaving the chat and coming back, and switching between workspaces, and it SHALL NOT
change what any other device shows. A device that refuses persistent storage SHALL still be able to
resize the region for as long as the chat is open.

The human SHALL be able to give the chosen height back in one gesture on the handle, after which the
region behaves as it did before any height was chosen. Resizing SHALL NOT change any decision, SHALL
NOT answer or hide one, and SHALL NOT be sent anywhere.

While the region is being resized and once the resize has finished, the message list SHALL keep
following its own newest message if it was doing so when the resize began.

When no decision is pinned the region is not shown, and the handle is not shown with it; the
remembered height SHALL apply again the next time a decision is pinned.

#### Scenario: Dragging the top edge up

- **WHEN** the human drags the pinned region's top edge towards the top of the screen
- **THEN** the region is taller than it was, and the message list is shorter by as much

#### Scenario: Dragging the top edge down

- **WHEN** the human drags a resized region's top edge back towards the bottom of the screen
- **THEN** the region is shorter than it was, and the message list is taller by as much

#### Scenario: Dragged past the small end

- **WHEN** the human drags the top edge further down than the smallest allowed height
- **THEN** the region stops at that height, with the first card's heading and its actions still on screen

#### Scenario: Dragged past the large end

- **WHEN** the human drags the top edge further up than the largest allowed height
- **THEN** the region stops at that height, with the composer and some of the conversation still on screen

#### Scenario: The keyboard opens after a resize

- **WHEN** an on-screen keyboard shrinks the viewport while the region is taller than the shrunken viewport allows
- **THEN** the region is shown no taller than the clamp permits, and the composer is still on screen

#### Scenario: The height outlives the page

- **WHEN** the human resizes the region and then reloads the chat, or switches to another workspace and opens its chat
- **THEN** the region is the height they chose

#### Scenario: Giving the height back

- **WHEN** the human performs the reset gesture on the handle
- **THEN** the region returns to the height it had before any height was chosen, and stays there after a reload

#### Scenario: Resizing answers nothing

- **WHEN** the human resizes the region while a decision is pinned
- **THEN** the decision is still open and unanswered, it is not hidden, and nothing is sent to the daemon

#### Scenario: The list still follows its bottom

- **WHEN** the human resizes the region while the message list is showing its newest message
- **THEN** the list is still showing its newest message when the resize ends

#### Scenario: The region empties and fills again

- **WHEN** the last pinned decision is answered and later another decision is raised
- **THEN** nothing is pinned in between, and the region returns at the height the human chose

### Requirement: The resize handle is reachable without a pointer

The handle that resizes the pinned region SHALL be focusable from the keyboard and SHALL carry a
name that says what it resizes, so that a human who is not using a pointer can find it and know what
it does. It SHALL report the height it is currently set to and the two heights it is clamped
between.

While it holds focus, the arrow keys SHALL make the region taller and shorter in steps within the
same clamps as dragging, and there SHALL be a key that goes directly to each clamp and a key that
gives the chosen height back. A height reached from the keyboard SHALL be remembered exactly as one
reached by dragging.

#### Scenario: Reaching the handle

- **WHEN** a human moves focus through the chat with the keyboard
- **THEN** the handle takes focus and is announced with a name saying it resizes the decisions area

#### Scenario: Resizing with the arrow keys

- **WHEN** the handle has focus and the human presses the arrow key towards the top of the screen
- **THEN** the region is taller by one step, and pressing the opposite arrow makes it shorter by one step

#### Scenario: Going straight to a clamp

- **WHEN** the handle has focus and the human presses the key for either clamp
- **THEN** the region is set to that clamp, and no further presses take it past it

#### Scenario: Giving the height back from the keyboard

- **WHEN** the handle has focus and the human presses the key that resets it
- **THEN** the region returns to the height it had before any height was chosen

#### Scenario: A keyboard height is remembered

- **WHEN** the human resizes the region from the keyboard and reloads the chat
- **THEN** the region is the height they set
