## Purpose

Keeps a roadmap block the human deliberately selected in the composer from being lost: the
selection is shown in the wake text the weaver reads, and filing a ticket in that turn is refused
unless the weaver records an explicit override reason.

## ADDED Requirements

### Requirement: A selected roadmap block is shown in the wake text the weaver reads

When an inbound human message carries a roadmap block, the text rendered for the weaver's turn SHALL
name the selected block and its project in plain words, in addition to the structured payload. The
block SHALL be named both in the "What was said" section of the turn prompt and on the message's
entry in `weave_inbox`, and the text SHALL say to add the ask to that block with
`weave_roadmap_item_add` and NOT to file a ticket for it unless the message explicitly says to start
the block.

When a message carries a project but no block, the wake text SHALL render exactly as it did before
this capability existed.

#### Scenario: A message with a block names it in the turn prompt

- **WHEN** a turn is woken by a human message that carried a project and one of its blocks
- **THEN** the rendered turn text's "What was said" section names the block's title and the project,
  and carries the instruction to add the ask with `weave_roadmap_item_add` rather than file a ticket

#### Scenario: A message with a block names it in weave_inbox

- **WHEN** the weaver reads `weave_inbox` for a turn woken by a human message that carried a block
- **THEN** the message entry carries the same named-block instruction alongside the message's payload

#### Scenario: A message with no block renders as before

- **WHEN** a turn is woken by a human message that carried a project but no block
- **THEN** the wake text is exactly as it was before this capability existed

### Requirement: Filing a ticket in a block-selected turn is refused without an override

`weave_ticket_create` SHALL be refused, with an error naming the selected block and directing the
weaver to `weave_roadmap_item_add`, or to `weave_roadmap_block_start` when the message asked to start
the block, when the current turn was woken by a human message that carried a `blockId` and the call
does not pass an explicit, non-empty `blockOverride`. Nothing SHALL be filed in that case. The guard
SHALL apply only to a weaver or agent caller, never to a human caller.

#### Scenario: A ticket is refused in the block-selected turn

- **WHEN** the weaver calls `weave_ticket_create` in a turn woken by a human message that carried a
  block, without `blockOverride`
- **THEN** the call is refused, the error names the block, and no ticket is created

#### Scenario: The refusal points at the block tools

- **WHEN** the refusal is returned
- **THEN** it names `weave_roadmap_item_add` and `weave_roadmap_block_start` as the correct next steps

### Requirement: An overridden ticket creation proceeds and records the reason

A `weave_ticket_create` call that passes a non-empty `blockOverride` in a block-selected turn SHALL
proceed and create the ticket, and SHALL record the override reason as an activity entry against the
created ticket, together with the selected block.

#### Scenario: Override files the ticket and records why

- **WHEN** the weaver calls `weave_ticket_create` with `blockOverride` in a turn woken by a message
  that carried a block
- **THEN** the ticket is created and an activity entry records the block and the override reason
  against it

### Requirement: The guard is scoped to the turn and to nothing else

The guard SHALL apply only to the turn woken by the human message that carried the block. A later
turn woken by a different message without a block, a worker turn, a routine turn, or a human caller
SHALL be unaffected. The guard SHALL NOT restrict `weave_roadmap_item_add`, comments, or any tool
other than `weave_ticket_create`.

#### Scenario: A later message without a block is unaffected

- **WHEN** a later turn is woken by a human message that carries no block
- **THEN** `weave_ticket_create` succeeds without `blockOverride`

#### Scenario: Adding a roadmap item is never blocked

- **WHEN** the weaver calls `weave_roadmap_item_add` in a block-selected turn
- **THEN** the call succeeds

#### Scenario: A worker or routine turn is unaffected

- **WHEN** `weave_ticket_create` is called in a worker turn or a routine turn
- **THEN** the guard does not apply and the call proceeds as before
