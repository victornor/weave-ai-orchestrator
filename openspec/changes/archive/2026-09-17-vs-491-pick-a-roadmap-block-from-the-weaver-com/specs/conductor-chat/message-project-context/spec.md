## ADDED Requirements

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
blocks beside its input as a second, horizontal, single-select strip: a leading **Any block** option
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
- **THEN** a block strip appears with an **Any block** option followed by the project's `open` blocks
  in block order

#### Scenario: A project with no open block offers nothing

- **WHEN** the human selects a project that has no blocks, or whose blocks are all `started`, `done`
  or `dropped`
- **THEN** no block strip is shown and the composer renders exactly as it does today

#### Scenario: Sending with a block chosen

- **WHEN** the human activates a block's tag and sends a message
- **THEN** the message is sent carrying that project and that block as its references

#### Scenario: Sending with no block chosen

- **WHEN** the human has **Any block** active and sends a message with a project selected
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

- **WHEN** the human has a block active and activates **Any block**
- **THEN** the block selection is cleared and a following send carries no block

#### Scenario: Changing the project clears the block choice

- **WHEN** the human has a block chosen under one project and selects a different project
- **THEN** the block selection is cleared

#### Scenario: A chosen block that is no longer offered is not carried

- **WHEN** the draft names a block that has since become `dropped`, and the human sends the message
- **THEN** the message carries no block reference

#### Scenario: A send clears the block choice

- **WHEN** the human sends a message with a block chosen
- **THEN** the message carries that block, and afterwards the strip's choice is **Any block**

#### Scenario: More blocks than fit at phone width

- **WHEN** the composer is rendered at a phone-sized viewport with more `open` blocks than fit
- **THEN** the block strip scrolls horizontally, every block remains reachable, and the composer's
  height and the position of the input and send control are unchanged from the same view with fewer
  blocks
