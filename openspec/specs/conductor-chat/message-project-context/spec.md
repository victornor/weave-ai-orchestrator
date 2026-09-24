# conductor-chat/message-project-context Specification

## Purpose
Defines how a human message to the conductor carries an optional project reference: how the human chooses it in the chat, how it is stored with the message, how it is shown back on the sent message, and how it reaches the conductor as structured context — so "do this" no longer has to name its project in prose.

## Requirements

### Requirement: A human message can carry an optional project reference

An inbound human message SHALL be able to carry a reference to one project in the workspace. The reference is optional: a message sent without one SHALL be accepted and SHALL behave exactly as a message sent before this capability existed.

When a reference is carried, it SHALL be stored durably with the message, and SHALL be returned with that message whenever the thread's messages are read.

#### Scenario: Message sent with a project

- **WHEN** a human message is sent to a thread with a project reference
- **THEN** the message is accepted, and reading the thread's messages afterwards returns that message with the same project reference

#### Scenario: Message sent without a project

- **WHEN** a human message is sent to a thread with no project reference
- **THEN** the message is accepted, is stored with no project reference, and the agent is woken exactly as it is for a message sent before this capability existed

#### Scenario: The conductor's own replies carry no project

- **WHEN** the conductor sends an outbound message to the thread
- **THEN** that message has no project reference

### Requirement: An unknown project reference is rejected

A message carrying a project reference that does not name a project of the message's own workspace SHALL be rejected with an error, and SHALL NOT be stored and SHALL NOT wake the agent. A project belonging to another workspace SHALL be treated the same as one that does not exist.

#### Scenario: Reference to a project that does not exist

- **WHEN** a human message is sent with a project reference that matches no project in the workspace
- **THEN** the request fails with an error, no message is stored in the thread, and no wake is enqueued

#### Scenario: Reference to another workspace's project

- **WHEN** a human message is sent with a project reference that names a project of a different workspace
- **THEN** the request fails in the same way as for a project that does not exist

### Requirement: The conductor receives the project reference as structured context

The wake raised by an inbound human message SHALL carry the message's project reference in its payload, alongside the thread, message and body it already carries. The payload SHALL identify the project both by its identifier and by its human-readable project key, so the conductor can act on it without a further lookup.

When the message carries no project reference, the payload SHALL say so explicitly rather than omitting the information ambiguously, and every other field SHALL be unchanged.

#### Scenario: The conductor reads its inbox after a message with a project

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried a project reference
- **THEN** the message entry's payload identifies that project by identifier and by key, in addition to the thread, message and body

#### Scenario: The conductor reads its inbox after a message with no project

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried no project reference
- **THEN** the message entry's payload reports no project, and the thread, message and body are as they were before this capability existed

#### Scenario: A message on a thread bound to a ticket

- **WHEN** a human message arrives on a thread that is bound to a ticket
- **THEN** it lands as a comment on that ticket and wakes that ticket's worker exactly as before, and the ticket's own project remains the project of record for that work

### Requirement: The conductor chat offers a project selector beside its input

The web conductor chat SHALL show a project selector next to the message input, rendered as a
horizontal, single-select strip of tags rather than a dropdown: an **Auto** tag in the leading
position, meaning "no project", followed by one tag per project in the workspace that is not
archived. The current choice SHALL be visually distinct at a glance — by more than a subtle border
— without opening or expanding any control, and SHALL be exposed to assistive technology as a
single-select group with an accessible label equivalent to "Project for this message", every tag
reachable and operable by keyboard.

Every project's tag, whether or not it is the active selection, SHALL show that project's name in
that project's own colour (`workspace-navigation/project-colour`), so the same colour that
identifies a project elsewhere in the app identifies it here too. The tag SHALL NOT show a
project-colour circle. The **Auto** tag, having no project, SHALL leave its label in the default
text colour. The active-selection styling (background and border) and a project's text colour are
independent and both SHALL be visible together when a project's tag is the active choice.

An archived project SHALL NOT be offered, except one the thread's most recent human message
already carries, which stays visible so the strip is honest about what the next message would
carry; this holds even when that archived project is the current selection.

At most one tag SHALL be active at a time. Activating the tag that is already active SHALL either
do nothing or return the selection to Auto — the same tag SHALL NOT stay active-and-clickable to
some other effect.

Sending a message SHALL carry the current choice with it. Choosing Auto SHALL send the message
with no project reference.

#### Scenario: Choosing a project and sending

- **WHEN** the human activates a project's tag and sends a message
- **THEN** the message is sent carrying that project as its reference

#### Scenario: Sending with no project chosen

- **WHEN** the human has the Auto tag active and sends a message
- **THEN** the message is sent with no project reference

#### Scenario: The workspace has no projects yet

- **WHEN** the chat is open in a workspace that has no projects
- **THEN** the strip shows only the Auto tag, and sending a message still works

#### Scenario: Sending while offline

- **WHEN** the human sends a message with a project chosen while the app is offline
- **THEN** the queued message retains that project reference and is sent with it when the queue is flushed

#### Scenario: An archived project the thread already used stays offered

- **WHEN** the thread's most recent human message carried a project that has since been archived
- **THEN** that project's tag is still shown in the strip, and remains shown as the current selection

#### Scenario: Activating the already-active project tag

- **WHEN** the human activates the tag that is currently the active selection
- **THEN** either nothing changes, or the selection returns to Auto — the tag does not send any other project as a result

#### Scenario: Each project's tag shows its own colour

- **WHEN** the strip renders with two or more projects offered
- **THEN** each project's tag shows that project's name in that project's own colour, with no
  project-colour circle, and the Auto tag shows none

#### Scenario: A project's colour is shown whether or not it is selected

- **WHEN** a project's tag is the active selection
- **THEN** the tag shows both the active-selection styling and that project's name in that
  project's own colour

### Requirement: The selector defaults to the thread's last choice

When the chat opens a thread, the selector SHALL default to the project carried by the most recent human message in that thread, and SHALL default to "no project" when that message carried none or when the thread has no human messages yet.

The default SHALL be derived from the thread's own stored messages, so the same thread opened on another device offers the same default.

A choice the human made for a message they have not sent yet SHALL take precedence over that default while the draft it belongs to lasts, so leaving the page and returning offers the message back as it was being written. Once the draft is gone, the default is the thread's last choice again.

#### Scenario: Reopening a thread whose last message named a project

- **WHEN** the human opens a thread whose most recent message carried a project
- **THEN** the selector shows that project as the current choice

#### Scenario: Reopening a thread whose last message named no project

- **WHEN** the human opens a thread whose most recent message carried no project
- **THEN** the selector shows the "no project" option as the current choice

#### Scenario: A thread with no messages

- **WHEN** the human opens a thread that has no messages yet
- **THEN** the selector shows the "no project" option as the current choice

#### Scenario: Changing the choice within a session

- **WHEN** the human changes the selection and sends a message
- **THEN** subsequent messages in that session default to the new choice, and it remains the default after the chat is reloaded

#### Scenario: Choosing a project for a message that has not been sent

- **WHEN** the human changes the selection, does not send, leaves the page and returns to the thread
- **THEN** the selector still shows the project they chose

### Requirement: A sent message shows the project it carried

A human message shown in the conductor chat SHALL display the project it was sent with, so the human can see afterwards what context went with it. A message sent with no project SHALL display no such marker and SHALL render as it did before this capability existed.

#### Scenario: A message sent with a project

- **WHEN** a human message that carried a project is rendered in the chat
- **THEN** it is shown with a marker naming that project

#### Scenario: A message sent without a project

- **WHEN** a human message that carried no project is rendered in the chat
- **THEN** no project marker is shown on it

#### Scenario: A project removed after the message was sent

- **WHEN** a message references a project that no longer exists in the workspace
- **THEN** the chat still renders the message and does not fail, showing whatever it can identify of the project

### Requirement: The project strip overflows by scrolling, never by growing

The strip SHALL fit any number of projects, from none to many more than fit in the available
width, without changing the layout around it. Overflow SHALL be handled by horizontal scrolling
of the strip itself, never by wrapping tags onto additional lines, never by growing the
composer's height, and never by reflowing or displacing the message input or the send control.

#### Scenario: More projects than fit at phone width

- **WHEN** the chat is rendered at a phone-sized viewport with enough projects that their tags exceed the available width
- **THEN** the strip scrolls horizontally, all tags remain reachable, and the composer's height and the position of the input and send control are unchanged from the same view with few projects

### Requirement: The selected tag is scrolled into view on mount

When the strip renders with a selection already made — reopening a thread, restoring a
draft — the selected tag SHALL be scrolled into view within the strip, so the current choice is
never left hidden past the visible edge.

#### Scenario: Reopening a thread whose selection is scrolled out of view

- **WHEN** the strip mounts with a project selected that would otherwise render outside the visible portion of the strip
- **THEN** the strip scrolls so that project's tag is visible

### Requirement: The selection resets to Auto after every send

Sending a message SHALL reset the strip's selection to Auto, regardless of what was chosen and
regardless of whether the send completed immediately or was queued for later because the app was
offline. A choice a message carried SHALL NOT persist as the selection for the next message: the
next message carries no project unless the human picks one again.

The reset SHALL be stored wherever the choice itself is persisted (the draft), so a reload after
sending does not resurrect the selection that was just cleared. The reset SHALL NOT scroll the
strip — scrolling on mount (the requirement above) is a separate concern from resetting on send,
and a reset must not move the strip out from under the human right after they act.

#### Scenario: Sending with a project selected

- **WHEN** the human sends a message with a project tag active
- **THEN** the message carries that project, and afterwards the strip's selection is Auto

#### Scenario: A queued offline send also resets the selection

- **WHEN** the human sends a message with a project tag active while the app is offline
- **THEN** the queued message carries that project, and afterwards the strip's selection is Auto

#### Scenario: The next message after a send defaults to Auto, not the previous choice

- **WHEN** the human sends a message with a project chosen, then sends a second message without picking again
- **THEN** the second message carries no project reference

#### Scenario: A reload after sending does not restore the cleared selection

- **WHEN** the human sends a message with a project chosen, then reloads the chat
- **THEN** the strip's selection is Auto, not the project that was cleared by the send

### Requirement: A human message can carry an optional roadmap block of its project

An inbound human message SHALL be able to carry a reference to one roadmap block, and only together
with a reference to that block's project. A message naming a block but no project SHALL be rejected
as `validation`. The named block SHALL exist in the message's workspace and SHALL belong to the
referenced project; a block that does not exist, or that belongs to another project, SHALL be
rejected as `not_found`. A rejected message SHALL NOT be stored and SHALL NOT wake the agent.

When a reference is carried, it SHALL be stored durably with the message, and SHALL be returned with
that message whenever the thread's messages are read.

#### Scenario: Message sent with a project and one of its blocks

- **WHEN** a human message is sent to a thread with a project and a block of that project
- **THEN** the message is accepted, and reading the thread's messages afterwards returns that message
  with the same block reference

#### Scenario: A block belonging to another project is rejected

- **WHEN** a human message is sent with a project and a block of a different project
- **THEN** the request fails as `not_found`, no message is stored in the thread, and no wake is
  enqueued

#### Scenario: An unknown block is rejected

- **WHEN** a human message is sent with a project and a block that matches no block in the workspace
- **THEN** the request fails as `not_found` and nothing is stored or woken

#### Scenario: A block without a project is rejected

- **WHEN** a human message is sent with a block and no project
- **THEN** the request fails as `validation` and nothing is stored or woken

#### Scenario: A message with a project but no block

- **WHEN** a human message is sent with a project and no block
- **THEN** it is accepted and stored exactly as a message sent before this capability existed, with no
  block reference

### Requirement: The conductor receives the block reference as structured context

The wake raised by an inbound human message that carries a block SHALL carry that block in its
payload, alongside the project the payload already carries. The payload SHALL identify the block both
by its identifier and by its human-readable title, so the conductor can add to it without a further
lookup. When the message carries no block, the payload SHALL say so explicitly rather than omitting
the information ambiguously, and every other field SHALL be unchanged.

#### Scenario: The conductor reads its inbox after a message with a block

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried a project
  and one of its blocks
- **THEN** the message entry's payload identifies that block by identifier and by title, in addition
  to the project by identifier and key, the thread, the message and the body

#### Scenario: The conductor reads its inbox after a message with no block

- **WHEN** the conductor reads its inbox for a turn woken by a human message that carried no block
- **THEN** the message entry's payload reports no block, and every other field is as it was before
  this capability existed

### Requirement: The conductor chat offers the tagged project's open roadmap blocks

The web conductor chat SHALL, when its project selector names a project that has at least one block
that is still open to new pending tickets — a block whose reported status is `open` — offer those
blocks beside its input as a second, horizontal, single-select strip: a leading **No block** option
meaning "no block", followed by one tag per such block, in the project's block order. The strip SHALL
be exposed to assistive technology as a single-select group with an accessible label equivalent to
"Roadmap block for this message", every option reachable and operable by keyboard.

When no project is selected, or the selected project has no `open` block, nothing SHALL be offered
and the composer SHALL render exactly as it does today.

The strip SHALL reflect the blocks that currently exist: a block created after the composer was
opened SHALL appear without a reload. A block whose reported status is `started`, `done` or
`dropped`, and a block belonging to a project other than the tagged one, SHALL NOT be offered.

At most one block SHALL be active at a time, and the choice SHALL be clearable through the **Any
block** option. Choosing the active block again SHALL either do nothing or clear it. Changing the
tagged project SHALL clear the block choice. A block the draft names that is no longer offered SHALL
NOT be shown as chosen and SHALL NOT be carried by a send.

Sending SHALL carry the current choice when there is one, and SHALL behave exactly as a message sent
before this capability existed when there is none. A confirmed send SHALL clear the block choice
together with the project.

Overflow SHALL be handled by horizontal scrolling of the block strip itself, never by wrapping tags
onto additional lines and never by reflowing or displacing the message input or the send control.

#### Scenario: A project with open blocks offers them in order

- **WHEN** the human selects a project that has two or more `open` blocks
- **THEN** a block strip appears with a **No block** option followed by the project's `open` blocks
  in block order

#### Scenario: A project with no open block offers nothing

- **WHEN** the human selects a project that has no blocks, or whose blocks are all `started`, `done`
  or `dropped`
- **THEN** no block strip is shown and the composer renders exactly as it does today

#### Scenario: Sending with a block chosen

- **WHEN** the human activates a block's tag and sends a message
- **THEN** the message is sent carrying that project and that block as its references

#### Scenario: Sending with no block chosen

- **WHEN** the human has **No block** active and sends a message with a project selected
- **THEN** the message is sent exactly as a message with a project and no block was sent before this
  capability existed

#### Scenario: A block created after the composer was opened appears

- **WHEN** the composer already offers a project's blocks and a new `open` block is created for that
  project
- **THEN** the new block appears in the strip without reloading the page

#### Scenario: A dropped or foreign block is never offered

- **WHEN** the tagged project has a `dropped` block, or another project has an `open` block
- **THEN** neither is offered in the strip

#### Scenario: Clearing the block choice

- **WHEN** the human has a block active and activates **No block**
- **THEN** the block selection is cleared and a following send carries no block

#### Scenario: Changing the project clears the block choice

- **WHEN** the human has a block chosen under one project and selects a different project
- **THEN** the block selection is cleared

#### Scenario: A chosen block that is no longer offered is not carried

- **WHEN** the draft names a block that has since become `dropped`, and the human sends the message
- **THEN** the message carries no block reference

#### Scenario: A send clears the block choice

- **WHEN** the human sends a message with a block chosen
- **THEN** the message carries that block, and afterwards the strip's choice is **No block**

#### Scenario: More blocks than fit at phone width

- **WHEN** the composer is rendered at a phone-sized viewport with more `open` blocks than fit
- **THEN** the block strip scrolls horizontally, every block remains reachable, and the composer's
  height and the position of the input and send control are unchanged from the same view with fewer
  blocks

### Requirement: A sent message shows the roadmap block it carried

A human message shown in the conductor chat that was sent with a roadmap block SHALL display that
block on the message, beside the project marker it already shows, in the same tag idiom rather than a
second style of chip, and SHALL name the block by its human-readable title rather than by its
identifier. The marker SHALL be shown only when the message's block can be named; an identifier SHALL
never be shown in its place. A message sent with a project and no block SHALL render exactly as it did
before this capability existed, showing only the project marker.

The block marker SHALL NOT displace or narrow the message body, and SHALL read correctly at phone
width as well as on desktop.

#### Scenario: A message sent with a project and a block shows both

- **WHEN** a human message that carried a project and one of that project's blocks is rendered in the
  chat
- **THEN** the message is shown with both the project marker and a marker naming that block

#### Scenario: A message sent with a project and no block is unchanged

- **WHEN** a human message that carried a project and no block is rendered in the chat
- **THEN** it is shown with the project marker only, exactly as a message sent before this capability
  existed

#### Scenario: The marker names the block, not its id

- **WHEN** a message that carried a roadmap block is rendered
- **THEN** the marker shows that block's current title, and never its identifier

#### Scenario: A block that can no longer be named shows no marker

- **WHEN** a message carried a block that can no longer be resolved to a title
- **THEN** the message renders without a block marker and still renders its body, project marker and
  metadata

#### Scenario: The marker reads at phone width

- **WHEN** a message carrying a project and a block is rendered at a phone-sized viewport
- **THEN** the marker and the project marker stay within the message's own column, the message body is
  unchanged, and nothing is pushed outside the viewport
