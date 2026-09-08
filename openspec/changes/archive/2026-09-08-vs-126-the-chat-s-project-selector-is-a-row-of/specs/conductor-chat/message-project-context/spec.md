## MODIFIED Requirements

### Requirement: The conductor chat offers a project selector beside its input

The web conductor chat SHALL show a project selector next to the message input, rendered as a
horizontal, single-select strip of tags rather than a dropdown: an **Auto** tag in the leading
position, meaning "no project", followed by one tag per project in the workspace that is not
archived. The current choice SHALL be visually distinct at a glance — by more than a subtle border
— without opening or expanding any control, and SHALL be exposed to assistive technology as a
single-select group with an accessible label equivalent to "Project for this message", every tag
reachable and operable by keyboard.

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

## ADDED Requirements

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
