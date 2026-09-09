## MODIFIED Requirements

### Requirement: The conductor chat offers a project selector beside its input

The web conductor chat SHALL show a project selector next to the message input, rendered as a
horizontal, single-select strip of tags rather than a dropdown: an **Auto** tag in the leading
position, meaning "no project", followed by one tag per project in the workspace that is not
archived. The current choice SHALL be visually distinct at a glance — by more than a subtle border
— without opening or expanding any control, and SHALL be exposed to assistive technology as a
single-select group with an accessible label equivalent to "Project for this message", every tag
reachable and operable by keyboard.

Every project's tag, whether or not it is the active selection, SHALL also show that project's own
colour (`workspace-navigation/project-colour`), so the same colour that identifies a project
elsewhere in the app identifies it here too. The **Auto** tag, having no project, SHALL show no
colour marker. The active-selection styling and a project's colour marker are independent and both
SHALL be visible together when a project's tag is the active choice.

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
- **THEN** each project's tag shows that project's own colour, and the Auto tag shows none

#### Scenario: A project's colour is shown whether or not it is selected

- **WHEN** a project's tag is the active selection
- **THEN** the tag shows both the active-selection styling and that project's own colour
