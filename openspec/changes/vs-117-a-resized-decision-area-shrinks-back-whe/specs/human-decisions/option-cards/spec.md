## MODIFIED Requirements

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
share of the viewport the app chooses, which is what it is today. Once they have chosen one, that
chosen height SHALL be the region's maximum rather than its fixed size: the region SHALL still be
exactly as tall as its contents, up to the chosen height, and SHALL scroll within itself only when
its contents need more than that. Content shorter than the chosen height SHALL NOT be padded out to
fill it, whether that content is open cards, the count of what is hidden, or both together. The
handle stays part of the region's own content rather than a fixed overlay, so it SHALL remain
reachable at whatever height the region actually takes, including its shortest.

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
remembered height SHALL apply again, as a maximum, the next time a decision is pinned.

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
- **THEN** the region is capped at the height they chose

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
- **THEN** nothing is pinned in between, and the region returns exactly as tall as the new decision's card, capped at the height the human chose

#### Scenario: Every card hidden at a chosen height

- **WHEN** every open decision is hidden from the chat while the region is holding a height chosen for a screenful of cards
- **THEN** the region is exactly as tall as the hidden-count line and its handle, not the chosen height

#### Scenario: Content shorter than the chosen height

- **WHEN** the open decisions and any hidden-count line together are shorter than the height the human chose
- **THEN** the region is exactly as tall as they are, and does not grow to fill the chosen height

#### Scenario: Re-showing hidden cards restores the chosen height's worth of content

- **WHEN** the human shows every hidden decision again while the region is holding a height chosen for a screenful of cards
- **THEN** the region grows back up to that height's worth of content, without the human resizing again
