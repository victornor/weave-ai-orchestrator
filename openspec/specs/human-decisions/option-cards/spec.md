# human-decisions/option-cards Specification

## Purpose
Defines how a decision that carries a defined set of options is put to the human and answered: how its card reads, where it waits in the conductor chat, how it is answered from the chat and from `Needs you`, and what it shows once it has been answered — so that a choice the conductor is waiting on is always on screen, answerable in one gesture, and still readable in the history afterwards.

## Requirements

### Requirement: The conductor asks with options when the answer is a closed set

When the conductor needs an answer from the human that is one of a small, known set of alternatives, it SHALL raise a decision carrying those alternatives as options rather than putting the choice to the human as prose alone. The options SHALL be the answers the conductor is actually willing to act on, and the conductor SHALL say which one it recommends when it has a view.

Nothing about which questions the conductor asks, or how it words them, is changed by this requirement; it governs only the form a closed-set question takes.

#### Scenario: A choice between known alternatives

- **WHEN** the conductor needs the human to choose between a small, known set of answers
- **THEN** it raises a decision whose options are those answers

#### Scenario: An open-ended question

- **WHEN** the conductor needs something from the human that has no closed set of answers
- **THEN** it asks in prose, and no decision is raised

### Requirement: A decision with options is presented as a card

A decision awaiting the human SHALL be presented as a card showing the question, the context or recommendation behind it, and each of its options with its label and, when there is one, what that option means. An option the asker recommended SHALL be marked as such.

When the decision permits an answer in the human's own words, the card SHALL offer that as an alternative alongside the options. When it does not, the card SHALL offer only its options.

A card SHALL show what the decision is attached to — the ticket it concerns, when it concerns one — and SHALL say who is asking, distinguishing a question raised by the conductor from one raised by a worker.

A card SHALL also always say which project the decision belongs to. A decision that concerns a ticket belongs to that ticket's project. A decision that concerns no ticket belongs to the project the asker named when raising it, or, when the asker named none and works on one project, to that project. A decision that belongs to no project SHALL be labelled as belonging to the workspace rather than left unlabelled, so that a card with no project label can never be read as a card whose project is merely unknown.

The project label SHALL be shown on every surface that offers the card, and SHALL NOT be displaced by anything else the card has to show about what it concerns.

#### Scenario: A question with options

- **WHEN** a decision carrying two or more options is shown to the human
- **THEN** the card shows the question and every option, each exactly once, with the recommended option marked

#### Scenario: An answer in the human's own words is allowed

- **WHEN** a decision allows an answer that is not one of its options
- **THEN** the card offers a way to write an answer as well as the options

#### Scenario: An answer in the human's own words is not allowed

- **WHEN** a decision requires one of its options
- **THEN** the card offers no way to write a different answer

#### Scenario: Who is asking

- **WHEN** the conductor raised the question
- **THEN** the card attributes it to the conductor rather than to a worker

#### Scenario: A decision about a ticket

- **WHEN** a decision concerning a ticket is shown to the human
- **THEN** the card names the project that ticket belongs to

#### Scenario: A decision the asker attached to a project

- **WHEN** the conductor raises a decision that concerns no ticket and names a project
- **THEN** the card names that project

#### Scenario: A decision that belongs to no project

- **WHEN** a decision concerns no ticket and no project was named or implied
- **THEN** the card says the decision belongs to the workspace

#### Scenario: The same label everywhere

- **WHEN** the same decision is offered in the conductor chat, in `Needs you` and on its ticket
- **THEN** every one of them shows the same project label

### Requirement: Answering takes a choice and a send

Choosing an option on a card SHALL select it and SHALL NOT answer the decision. The card SHALL show which option is selected and SHALL offer a single action that sends the selected answer. Sending SHALL answer the decision with the selected option.

When the human writes an answer instead, sending that text SHALL answer the decision with those words.

Until an answer is sent, no answer SHALL be recorded, and the human SHALL be able to change the selection.

#### Scenario: Selecting does not answer

- **WHEN** the human picks one of a card's options
- **THEN** the option is shown as selected and the decision is not yet answered

#### Scenario: Changing the selection

- **WHEN** the human picks one option and then another before sending
- **THEN** the second option is the selected one, and the decision is still unanswered

#### Scenario: Sending the selected option

- **WHEN** the human sends after selecting an option
- **THEN** the decision is answered with that option

#### Scenario: Sending an answer in the human's own words

- **WHEN** the human writes an answer on the card and sends it
- **THEN** the decision is answered with those words

### Requirement: An answer from a card reaches the asker

An answer sent from a card SHALL be recorded against that decision exactly as an answer given any other way, and the agent that asked the question SHALL be woken with it, so that answering by card and answering in prose have the same consequences.

When the card collected values as well as a choice, those values SHALL travel with the answer: they SHALL be recorded against the decision and SHALL be part of what the asker is woken with, so that the asker never has to read the values out of the conversation.

#### Scenario: The conductor is told

- **WHEN** the human answers a conductor question from a card
- **THEN** the answer is recorded against that decision and the conductor is woken with it

#### Scenario: An answer that is refused

- **WHEN** an answer cannot be recorded — the decision has already been answered, withdrawn or superseded
- **THEN** the human is told, and the card reflects the decision's real state rather than claiming the answer was taken

#### Scenario: The values come with the answer

- **WHEN** the human answers a card that collected values as well as a choice
- **THEN** the recorded answer carries those values and the asker is woken with them

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

### Requirement: The same question waits in Needs you

Every open decision awaiting the human SHALL appear in `Needs you` as a card with the same question and the same options as the card in the conversation, so that nothing the conductor is waiting on is reachable only by scrolling the chat.

Answering the decision in either place SHALL resolve it in both: the answer is recorded once, and both surfaces then show it as answered without the human having to answer again.

#### Scenario: A conductor question is waiting

- **WHEN** the conductor raises a question for the human
- **THEN** it appears in `Needs you` as a card with the same question and the same options

#### Scenario: Answered from Needs you

- **WHEN** the human answers the question in `Needs you`
- **THEN** the decision is answered, and the chat shows that card as answered rather than as waiting

#### Scenario: Answered from the chat

- **WHEN** the human answers the question in the chat
- **THEN** it is no longer waiting in `Needs you`

### Requirement: Prose questions are unaffected

A conductor message that is not backed by a decision SHALL be shown as it is today, with nothing added to it, and SHALL be answerable by replying in the conversation. The presence of the card mechanism SHALL NOT require a question to carry options in order to be asked or answered.

#### Scenario: A question asked in prose

- **WHEN** the conductor asks the human something in prose, with no decision behind it
- **THEN** the message renders as an ordinary message and no card appears for it

#### Scenario: Answering in prose

- **WHEN** the human replies to a prose question in the conversation
- **THEN** the reply reaches the conductor exactly as it does today

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

### Requirement: A merge-approval card links to a conversation with the worker that asked it

A `merge_approval` decision card SHALL offer a way to open a conversation with the worker that asked
it, alongside its existing approve and hold actions, so the human can ask about the work before
answering rather than only after.

#### Scenario: The link is offered on a merge-approval card

- **WHEN** a `merge_approval` decision card is shown to the human
- **THEN** it offers a way to open a conversation with the worker that asked it

#### Scenario: Other decision kinds are unaffected

- **WHEN** a decision card of a kind other than `merge_approval` is shown to the human
- **THEN** it offers no such link
