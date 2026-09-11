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

The copy SHALL be factual, not an endorsement, and SHALL be exactly this weight:

- **not looked at yet** — loud: the card shows the text `Conductor hasn't looked yet`
- **looked at** — understated but present: the card shows the text `Conductor looked` (or the after-the-fact variant). Quiet means dimmer type, not missing type. It SHALL NOT use a green seal, a checkmark of approval, or the words "signed off" / "approved by the conductor", and SHALL NOT be hidden, collapsed, or left as whitespace
- **looked at, with concerns** — loudest: the card shows `Conductor looked — has concerns` (or the after-the-fact variant)

When the state is **looked at, with concerns**, the card SHALL show the concern summary next to the action buttons, so a human tapping through a queue sees the objection at the moment of the decision rather than only in a chat message they may not have read. The concern is a short block of text, not a badge wrapping a sentence.

When `reviewedAt` is strictly later than `answeredAt`, the card SHALL say that the look arrived after the answer, distinct from a look that arrived before. An unanswered card never uses after-the-fact wording.

A card for any other decision kind SHALL NOT show a conductor review line.

Showing the review state SHALL NOT disable, delay, hide, or relabel any action the card already offers. The buttons stay the same keys, the same number, and the same immediate send.

A later review on an already-shown card SHALL become visible without a reload on any surface that already refreshes a live decision (the web app over the workspace event stream). A channel that pushed the card once as an outbound message SHALL NOT send a second answerable card with a duplicate set of approve buttons; if it surfaces a later **looked at, with concerns** at all, it does so as text, not as a new decision to answer.

#### Scenario: An unseen plan card says the conductor has not looked

- **WHEN** an open `plan_approval` whose review state is **not looked at yet** is shown as a card
- **THEN** the card says the conductor has not looked yet
- **AND** its Approve, Revise and Reject actions are enabled and send the same keys they send today

#### Scenario: A looked-at merge card is quiet

- **WHEN** an open `merge_approval` whose review state is **looked at** is shown as a card
- **THEN** the card shows the text that the conductor looked
- **AND** that text is present in the rendered card, not omitted or replaced with a blank
- **AND** it does not present that look as an approval, a sign-off, or a green endorsement
- **AND** its Approve merge and Request changes actions are unchanged

#### Scenario: A clean look is never a blank

- **WHEN** an open `plan_approval` whose review state is **looked at** is shown as a card
- **THEN** the review line is visible and reads that the conductor looked
- **AND** a reader can tell it apart from a card whose review state is **not looked at yet** without relying on the line being absent

#### Scenario: A concern sits next to the buttons

- **WHEN** an open `merge_approval` whose review state is **looked at, with concerns** is shown as a card
- **THEN** the card says the conductor looked and has concerns
- **AND** the concern summary is visible next to the action buttons without opening the chat or another page

#### Scenario: After-the-fact look is worded differently

- **WHEN** a card shows a `plan_approval` that was answered and then marked **looked at**, with the review timestamp after `answeredAt`
- **THEN** the card says the conductor looked after the answer, not merely that the conductor looked

#### Scenario: After-the-fact concern is worded differently and still shown

- **WHEN** a card shows a `merge_approval` that was answered and then marked **looked at, with concerns**, with the review timestamp after `answeredAt`
- **THEN** the card says the look arrived after the answer and still shows the concern summary

#### Scenario: A question card has no review line

- **WHEN** a `question` decision is shown as a card
- **THEN** the card has no conductor-review line, whatever other decisions on the same ticket show

#### Scenario: Needs you and the ticket page agree with chat

- **WHEN** the same open `plan_approval` is shown in the conductor chat, in `Needs you`, and on the ticket page
- **THEN** all three cards show the same review state and, when there is one, the same concern summary

#### Scenario: A live web card picks up a mark without reload

- **WHEN** an open `plan_approval` card is on screen as **not looked at yet** and the conductor then marks it **looked at, with concerns**
- **THEN** that card updates to show the concern state and the summary without the human reloading the page

#### Scenario: Telegram does not grow a second approve card

- **WHEN** a channel has already pushed an answerable card for an open `merge_approval`, and the conductor later marks it **looked at, with concerns**
- **THEN** the channel does not send a second answerable card with Approve / Request changes buttons
