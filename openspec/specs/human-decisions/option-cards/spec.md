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

The context or recommendation text SHALL be rendered as markdown, through the same rendering and
one-tap copy treatment the conductor chat gives a message, rather than as plain text — so a command
the asker wrote for the human to run is exactly as copyable on a card as it is in the chat. This
holds whoever asked: a worker's context is rendered the same way a conductor's is.

When the decision permits an answer in the human's own words, the card SHALL offer that as an alternative alongside the options. When it does not, the card SHALL offer only its options.

A card SHALL show what the decision is attached to — the ticket it concerns, when it concerns one — and SHALL say who is asking, distinguishing a question raised by the conductor from one raised by a worker.

A card SHALL also always say which project the decision belongs to. A decision that concerns a ticket belongs to that ticket's project. A decision that concerns no ticket belongs to the project the asker named when raising it, or, when the asker named none and works on one project, to that project. A decision that belongs to no project SHALL be labelled as belonging to the workspace rather than left unlabelled, so that a card with no project label can never be read as a card whose project is merely unknown.

The project label SHALL be shown on every surface that offers the card, and SHALL NOT be displaced by anything else the card has to show about what it concerns.

#### Scenario: A question with options

- **WHEN** a decision carrying two or more options is shown to the human
- **THEN** the card shows the question and every option, each exactly once, with the recommended option marked

#### Scenario: Context rendered as markdown

- **WHEN** a decision's context contains markdown — bold text, a backticked command, a bulleted list
- **THEN** the card shows it formatted rather than as literal asterisks, backticks or list markers

#### Scenario: A command in a card's context is copyable

- **WHEN** a decision's context contains a fenced or inline code span
- **THEN** the card offers the same one-tap copy control a chat message would offer for that span

#### Scenario: A worker's context is rendered the same way

- **WHEN** a decision raised by a worker carries context text
- **THEN** it is rendered as markdown exactly as a conductor-raised decision's context would be

#### Scenario: Untrusted context cannot escalate

- **WHEN** a decision's context — which may come from a worker's repository contents or tool
  output rather than from the conductor — contains an attempted script, or a link or image whose
  target is not a plain web address, an absolute path or a page anchor
- **THEN** it is rendered as inert text with nothing executed, and no such link or image is
  produced

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

### Requirement: A conductor chat card shows when the conductor filed the ticket itself

In the conductor chat's decisions list — the pinned-open cards and the answered cards shown in the
conversation — a decision card that concerns a ticket SHALL show a small tag saying the ticket was
filed by the conductor when that ticket was created by the conductor on its own initiative rather
than at the human's request. A decision whose ticket was created by the human, or a decision that
concerns no ticket, SHALL show no such tag.

This requirement governs the conductor chat's decisions list only. A decision card shown on any
other surface — `Needs you`, a ticket's own page, or anywhere else a card is rendered — is
unaffected.

#### Scenario: The conductor filed the ticket

- **WHEN** a decision card in the conductor chat's decisions list concerns a ticket the conductor
  created on its own initiative
- **THEN** the card shows a tag saying the ticket was filed by the conductor

#### Scenario: The human filed the ticket

- **WHEN** a decision card in the conductor chat's decisions list concerns a ticket the human
  created, or asked the conductor to create
- **THEN** the card shows no provenance tag

#### Scenario: No ticket at all

- **WHEN** a decision card in the conductor chat's decisions list concerns no ticket
- **THEN** the card shows no provenance tag

#### Scenario: Other surfaces are unaffected

- **WHEN** the same decision is shown in `Needs you` or on its ticket's own page
- **THEN** no provenance tag is shown there, whatever the card in the chat shows

### Requirement: A plan-approval card shows a one-line reminder of what its ticket is for

A ticket SHALL be able to carry a short, one-line summary, set when it is created or at any time
afterwards, independent of its full description. Setting it SHALL NOT require a model call, and
nothing about rendering a card that shows it SHALL require one either.

A `plan_approval` decision card in the conductor chat's decisions list SHALL show that ticket's
summary, when it has one, as a one-line reminder of what the ticket is for, so the human can decide
without opening the ticket. A `plan_approval` card for a ticket with no summary SHALL show no such
line — never a heading, a quoted fragment, or any other text derived from the ticket's full
description in its place.

This requirement governs the conductor chat's decisions list only; other surfaces that render a
`plan_approval` card are unaffected.

#### Scenario: A ticket with a summary

- **WHEN** a `plan_approval` decision card in the conductor chat's decisions list concerns a ticket
  that has a one-line summary
- **THEN** the card shows that summary as a single line

#### Scenario: A ticket with no summary

- **WHEN** a `plan_approval` decision card in the conductor chat's decisions list concerns a ticket
  that has no summary
- **THEN** the card shows no summary line, and nothing derived from the ticket's description takes
  its place

#### Scenario: Setting a summary after the ticket was created

- **WHEN** a ticket that was created before it had a summary is given one afterwards
- **THEN** a `plan_approval` card for that ticket shows the summary from then on

### Requirement: The conductor chat renders a decision card compactly

A decision card in the conductor chat's decisions list SHALL be rendered with less padding, tighter
vertical spacing between its sections, and a smaller button footprint than the same card would take
on any other surface, while showing every field the card shows on those other surfaces. No
information the card carries SHALL be moved behind an expander, a "show more" control, or any other
mechanism that hides it by default, as a way of achieving this.

Every action a card offers SHALL remain reachable with a single tap and SHALL NOT be sized below
what a reliable tap on a handheld touch screen needs.

#### Scenario: A plan-approval card in the chat is more compact

- **WHEN** a `plan_approval` decision card is shown in the conductor chat's decisions list
- **THEN** it shows the same title, context, task list, summary line and actions as the same card
  would show elsewhere, in less vertical space

#### Scenario: Nothing is hidden to save space

- **WHEN** a decision card is rendered compactly in the conductor chat
- **THEN** no field it would otherwise show is moved behind an expander or a "show more" control

#### Scenario: Other surfaces keep their current layout

- **WHEN** the same decision is shown in `Needs you` or on its ticket's own page
- **THEN** it is rendered exactly as it was before this change

#### Scenario: Actions stay reachable on a phone

- **WHEN** a decision card is rendered compactly and viewed at a phone width
- **THEN** every action it offers is still reachable with a single tap at a size fit for a touch
  screen

### Requirement: A plan, merge or action approval card shows whether the conductor has looked

Every surface that renders a `plan_approval`, `merge_approval`, or `action_approval` as a card — the conductor chat (pinned and in history), `Needs you`, the ticket page, the TUI, and `conductor decision show` — SHALL show that decision's conductor review state.

Each of the three states SHALL have its own visible rendering. No state SHALL be conveyed by omitting the review line: a blank would make **looked at** indistinguishable from **not looked at yet**, which is the distinction this requirement exists to make.

The copy SHALL state the outcome of the review rather than the bare activity, and SHALL claim no more than the mark asserts. Exactly this weight:

- **not looked at yet** — loud: the card shows the text `Conductor hasn't reviewed yet`
- **looked at** — conclusive but not a sign-off: the card shows the text `Conductor reviewed — no concerns` (or the after-the-fact variant). It SHALL NOT use a green seal, a checkmark of approval, or the words "signed off" / "approved by the conductor", and SHALL NOT be hidden, collapsed, or left as whitespace
- **looked at, with concerns** — loudest: the card shows `Conductor reviewed — has concerns` (or the after-the-fact variant)

A mark made after notes were required carries its note, and the card SHALL show that note next to the action buttons — a clean mark's stated reason exactly as a concern's summary is shown — so the human reads the conductor's conclusion and its justification at the moment of the decision rather than hunting the chat for it. A mark made before notes were required carries none; such a card SHALL still show the review line, sensibly, without a note. The line and note SHALL NOT claim the conductor approved, signed off, or vouches for the work: approving is the human's act.

When `reviewedAt` is strictly later than `answeredAt`, the card SHALL say that the look arrived after the answer, distinct from a look that arrived before. An unanswered card never uses after-the-fact wording.

A card for any other decision kind SHALL NOT show a conductor review line.

Showing the review state SHALL NOT disable, delay, hide, or relabel any action the card already offers. The buttons stay the same keys, the same number, and the same immediate send.

A later review on an already-shown card SHALL become visible without a reload on any surface that already refreshes a live decision (the web app over the workspace event stream). A channel that pushed the card once as an outbound message SHALL NOT send a second answerable card with a duplicate set of approve buttons; if it surfaces a later **looked at, with concerns** at all, it does so as text, not as a new decision to answer.

#### Scenario: An unseen plan card says the conductor has not looked

- **WHEN** an open `plan_approval` whose review state is **not looked at yet** is shown as a card
- **THEN** the card says the conductor has not reviewed yet
- **AND** its Approve, Revise and Reject actions are enabled and send the same keys they send today

#### Scenario: A looked-at merge card is quiet

- **WHEN** an open `merge_approval` whose review state is **looked at** is shown as a card, its mark carrying a note
- **THEN** the card shows that the conductor reviewed it and found nothing to object to, with the note visible next to the action buttons without opening the chat or another page
- **AND** the rendering does not present the mark as an approval, a sign-off, or a green endorsement
- **AND** its Approve merge and Request changes actions are unchanged

#### Scenario: A clean look is never a blank

- **WHEN** an open `plan_approval` whose review state is **looked at** is shown as a card
- **THEN** the review line is visible and reads as the conclusion of a review, not as a log entry
- **AND** a reader can tell it apart from a card whose review state is **not looked at yet** without relying on the line being absent

#### Scenario: A mark from before notes were required still renders

- **WHEN** a card shows a decision whose review state is **looked at** and whose mark carries no note
- **THEN** the card shows the review line without a note, with nothing blank, broken, or filler where a note would sit

#### Scenario: A concern sits next to the buttons

- **WHEN** an open `merge_approval` whose review state is **looked at, with concerns** is shown as a card
- **THEN** the card says the conductor reviewed it and has concerns
- **AND** the concern summary is visible next to the action buttons without opening the chat or another page

#### Scenario: After-the-fact look is worded differently

- **WHEN** a card shows a `plan_approval` that was answered and then marked **looked at**, with the review timestamp after `answeredAt`
- **THEN** the card says the conductor reviewed it after the answer, not merely that the conductor reviewed it

#### Scenario: After-the-fact concern is worded differently and still shown

- **WHEN** a card shows a `merge_approval` that was answered and then marked **looked at, with concerns**, with the review timestamp after `answeredAt`
- **THEN** the card says the look arrived after the answer and still shows the concern summary

#### Scenario: A question card has no review line

- **WHEN** a `question` decision is shown as a card
- **THEN** the card has no conductor-review line, whatever other decisions on the same ticket show

#### Scenario: Needs you and the ticket page agree with chat

- **WHEN** the same open `plan_approval` is shown in the conductor chat, in `Needs you`, and on the ticket page
- **THEN** all three cards show the same review state and, when there is one, the same note

#### Scenario: A live web card picks up a mark without reload

- **WHEN** an open `plan_approval` card is on screen as **not looked at yet** and the conductor then marks it **looked at, with concerns**
- **THEN** that card updates to show the concern state and the summary without the human reloading the page

#### Scenario: Answering a reviewed card is unchanged

- **WHEN** the human approves an open card whose review state is **looked at**, with or without a note
- **THEN** the answer is recorded at once with the same keys and effect as on an unseen card, and nothing in the answer path waited on the review or its note

#### Scenario: Telegram does not grow a second approve card

- **WHEN** a channel has already pushed an answerable card for an open `merge_approval`, and the conductor later marks it **looked at, with concerns**
- **THEN** the channel does not send a second answerable card with Approve / Request changes buttons

### Requirement: A decision that targets a document shows that document on its card

A decision whose target carries a document reference — a document id and the revision being decided — SHALL show that document's content on its card, whatever kind the decision is. The rendering SHALL be driven by the document reference on the decision, not by the decision's kind, so a decision of any kind carrying the same reference renders the same way. A decision with no document reference SHALL render exactly as it does without this capability, and no document region SHALL appear on its card.

The card SHALL show which revision of the document the human is being asked to decide on. When the document has moved past that revision, the card SHALL NOT present the older content as current: it SHALL say the document has been revised since the decision was raised, and label any shown content with the superseded revision it actually is. When the revision the decision names no longer exists, the card SHALL say so rather than showing nothing in its place or passing off other content as it.

The complete document SHALL be reachable from the card without leaving it: the content renders on the card, and a control on the card reveals or collapses it, so nothing the human needs in order to judge the decision lives one tap away.

A document SHALL NOT render twice on one card. Where a decision's document is already rendered by a purpose-built slot on that card — the plan-approval card's plan slot is the one today — the document SHALL render through that slot and SHALL NOT additionally render through the general preview. The suppression SHALL follow the slot the card is already rendering, not a new check on the decision's kind, so the next purpose-built slot suppresses the general preview the same way without touching this code path again.

#### Scenario: an action-approval card shows the action document

- **WHEN** an open `action_approval` carries a document reference and the document is at the revision it names
- **THEN** the card shows the document's content, with the revision it names
- **AND** a control on the card reaches the complete document

#### Scenario: another kind carrying the same reference renders the document too

- **WHEN** a decision of a kind other than `action_approval` carries the same document-reference shape
- **THEN** its card renders the document the same way, with no kind-specific check

#### Scenario: a plan approval renders its plan exactly once

- **WHEN** a `plan_approval` carries a document reference for the plan digest and its card also renders the plan slot
- **THEN** the plan document appears on the card exactly once, through the plan slot
- **AND** the general preview renders nothing for that card

#### Scenario: a decision with no document reference is unchanged

- **WHEN** a decision carries no document reference in its target
- **THEN** its card renders exactly as before, with no document region and no fetch of one

#### Scenario: a superseded revision is never shown as current

- **WHEN** a card's document reference names revision 2 and the document has since moved to revision 3
- **THEN** the card says the document was revised since the decision was raised
- **AND** any content it shows for revision 2 is labelled as the superseded revision, never as current

#### Scenario: a revision that no longer exists

- **WHEN** a card's document reference names a revision the document does not have
- **THEN** the card says that revision could not be found, naming what it asked for, and shows no other content in its place

#### Scenario: a missing document is said, not blank

- **WHEN** the document a card's reference names cannot be read at all
- **THEN** the card says the document could not be found rather than rendering an empty region

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
