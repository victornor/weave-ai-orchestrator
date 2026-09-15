## Purpose

Groups a project's future work into ordered, named blocks of pending tickets the weaver builds up
and bundles from chat, and turns a block into real tickets when captain starts it — so related small
asks become as few efficient tickets as possible instead of one ticket and one fresh worker each.

## ADDED Requirements

### Requirement: A roadmap block is an ordered, project-scoped group with a lifecycle

A roadmap block SHALL belong to exactly one project, SHALL be stored durably in the workspace
database, and SHALL have:

- a title, required and non-empty;
- markdown notes, defaulting to empty;
- a dense, zero-based manual order within its project;
- a status reported as exactly one of `open`, `started`, `done` or `dropped`;
- the time it was started, unset until it is started;
- who created it; and
- a creation time and an update time.

A block's stored status SHALL be one of `open`, `started` or `dropped`. A block whose stored status
is `started` SHALL be reported as `done` when it holds at least one item and every item is linked to
a ticket whose status is terminal (`done` or `cancelled`); otherwise its stored status SHALL be
reported. `done` SHALL NOT be settable through a write.

Blocks SHALL be ordered by hand within their project: creating one SHALL append it, and setting its
order SHALL renumber the project's blocks so the order stays dense and unique. A block SHALL
reference its project, and a project SHALL NOT be removable in a way that leaves an orphan block.

#### Scenario: A created block carries its fields

- **WHEN** a block is created for a project with a title and notes
- **THEN** it is stored `open`, its creator and creation time are recorded, and it is last in the
  project's block order

#### Scenario: An empty or unknown status is refused

- **WHEN** a block is created or updated with an empty title or a status other than `open`, `started`
  or `dropped`
- **THEN** the write is rejected as `validation`

#### Scenario: Blocks are ordered per project

- **WHEN** a project has blocks and one is moved to position `0`
- **THEN** it is first, the others shift down by one, and another project's block order is unchanged

#### Scenario: done is derived from the block's tickets

- **WHEN** a block has been started and every one of its items is linked to a ticket in `done` or
  `cancelled`
- **THEN** the block is reported `done`

#### Scenario: A block with an unfiled or open ticket is not done

- **WHEN** a started block has an item with no linked ticket, or one whose ticket is not terminal
- **THEN** the block is reported `started`

#### Scenario: Dropping a block retains it

- **WHEN** a block's status is set to `dropped`
- **THEN** it still exists and is still listed for its project with status `dropped`

### Requirement: A block holds ordered pending tickets carrying ticket fields

A roadmap item SHALL be assignable to at most one block of its own project, and a block SHALL expose
its items in the project's item order. A pending ticket SHALL carry the fields a real ticket needs:

- a title, required and non-empty;
- a markdown description, defaulting to empty and carrying the ticket's acceptance criteria;
- a kind, one of the ticket kinds, defaulting to `change`;
- a priority, one of the ticket priorities, defaulting to `medium`; and
- an optional target role of the project's own roles.

An item SHALL be movable between blocks of its project in one write, and a moved item SHALL keep its
own title, description, kind, priority, status and order. An item not assigned to any block SHALL
remain a loose item of its project, unchanged from before blocks existed.

#### Scenario: Adding a pending ticket appends it

- **WHEN** a pending ticket is added to a block with a title and description
- **THEN** it is stored with kind `change`, priority `medium`, no target role, and it is last among
  that block's items

#### Scenario: A pending ticket carries its ticket fields

- **WHEN** a pending ticket is added or updated with a kind, a priority and a target role
- **THEN** it is returned with those values
- **AND** a role or block not belonging to the item's project is refused as `not_found`

#### Scenario: Moving an item between blocks

- **WHEN** an item is moved from one block of its project to another, or to no block at all
- **THEN** it appears under the new block, or among the loose items, at the end of that group

#### Scenario: An unknown kind or priority is refused

- **WHEN** a pending ticket is created or updated with a kind or priority outside its enum
- **THEN** the write is rejected as `validation`

### Requirement: Pending tickets in one project can be merged, and the merge is recorded

Two or more pending tickets of one project SHALL be mergeable into one. The surviving item SHALL be
the one named first and SHALL keep its own block and status; its description SHALL become its own
description followed by each merged item's description, so acceptance criteria remain attributable.
A merge SHALL be refused as `validation` when fewer than two items are named, when an item belongs to
another project, or when any named item is already linked to a ticket. Every merged item SHALL be
recorded durably — its id, its title, its description snapshot, who merged it and when — before it is
removed, and the project's item order SHALL be renumbered densely. The surviving item SHALL expose
the records of what it absorbed.

#### Scenario: Merging two pending tickets

- **WHEN** two unlinked pending tickets of one project are merged into the first
- **THEN** one item remains, its description contains the other's, and a record of the merged item is
  retained and returned with the survivor

#### Scenario: A filed ticket is not merged

- **WHEN** a merge names an item already linked to a ticket
- **THEN** the write is refused as `validation` and nothing is changed

#### Scenario: A merge across projects is refused

- **WHEN** a merge names items from two different projects
- **THEN** the write is refused as `validation`

### Requirement: Starting a block returns its unfiled pending tickets as filing-ready drafts

Starting a block SHALL set its status to `started` and record the time it was started, and SHALL
return its pending tickets that are not yet linked to a ticket as drafts, each carrying the item's
own title, description, kind, priority and target role — the fields `weave_ticket_create` needs. It
SHALL NOT create any ticket itself, so ticket rules, tiers and blockers stay in the one place that
owns them. The weaver SHALL file each draft with `weave_ticket_create` and link the created ticket
back to the item. Starting an already-started block SHALL be idempotent and return the still-unfiled
drafts, so a partial filing can be retried. Starting a `dropped` block SHALL be refused as
`validation`.

#### Scenario: A start returns drafts and starts the block

- **WHEN** an open block with pending tickets is started
- **THEN** the result carries a draft per unfiled item with its title, description, kind, priority
  and target role
- **AND** the block is `started` with its start time recorded, and no ticket exists yet

#### Scenario: Filing and linking completes the block's items

- **WHEN** the weaver files each draft with `weave_ticket_create` and links each ticket to its item
- **THEN** the block's items each show their created ticket

#### Scenario: A start does not refile

- **WHEN** a started block is started again after some of its items were linked
- **THEN** only the items still without a linked ticket are returned as drafts

#### Scenario: A dropped block cannot be started

- **WHEN** a `dropped` block is started
- **THEN** the call is refused as `validation` and the block is unchanged
