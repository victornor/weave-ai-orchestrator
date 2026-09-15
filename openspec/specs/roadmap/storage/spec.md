# roadmap/storage Specification

## Purpose
Gives each project a durable list of future ideas — a remembered idea that is not yet a ticket —
scoped to the project, ordered by hand, and safe from outliving the project it belongs to.

## Requirements

### Requirement: A roadmap item is a durable, project-scoped record

A roadmap item SHALL belong to exactly one project and SHALL be stored durably in the workspace
database. It SHALL have:

- a title, required and non-empty;
- markdown notes, defaulting to empty;
- a manual order within its project;
- a status, exactly one of `idea`, `planned` or `dropped`, defaulting to `idea`;
- an optional linked ticket, unset until work starts;
- who created it; and
- a creation time and an update time.

The title, status and order of an item SHALL be independent of whether it has a linked ticket: an
item filed as an `idea` SHALL NOT become a ticket, and linking a ticket SHALL NOT change its status.

#### Scenario: A created item carries its fields

- **WHEN** a roadmap item is created for a project with a title and notes
- **THEN** it is stored with status `idea`, the creator recorded, and creation and update times set

#### Scenario: An idea is not a ticket

- **WHEN** an item with no linked ticket is read back
- **THEN** its status and order are its own, and no ticket is created for it

#### Scenario: An invalid status is refused

- **WHEN** an item is created or updated with a status other than `idea`, `planned` or `dropped`
- **THEN** the write is rejected as `validation`

#### Scenario: An empty title is refused

- **WHEN** an item is created or updated with an empty or whitespace-only title
- **THEN** the write is rejected as `validation`

### Requirement: Roadmap items are ordered by hand within their project

Each project's items SHALL carry a dense, zero-based order. Listing a project's items SHALL return
them in ascending order. Creating an item SHALL append it to the end of its project's order. Setting
an item's order SHALL renumber its siblings so the order stays dense and no two items in one project
share a position.

#### Scenario: Create appends

- **WHEN** an item is created in a project that already has two items
- **THEN** it is last in the listing and its position is after the existing two

#### Scenario: Reorder renumbers

- **WHEN** an item's position is set to `0` while it was last
- **THEN** it is first in the listing and the other items shift down by one, remaining dense

#### Scenario: Order is per project

- **WHEN** two projects each have items and one is reordered
- **THEN** the other project's item order is unchanged

### Requirement: Removing a project never leaves orphan roadmap items

A roadmap item SHALL reference its project, and a project SHALL NOT be removable in a way that
strands an item with no project. Because project removal in Weave AI is a soft archive — the project
row and its status `archived` are kept, not deleted — the items SHALL remain attached to the
archived project and SHALL stay readable through that project. The reference SHALL additionally
specify `ON DELETE CASCADE`, so that a future hard delete of a project removes its roadmap items with
it rather than leaving rows no project owns.

#### Scenario: An archived project keeps its roadmap

- **WHEN** a project with roadmap items is removed (archived)
- **THEN** its items still exist and are still listed for that project
- **AND** no item is left without a project

#### Scenario: A hard delete takes the items with it

- **WHEN** a project row is deleted outright
- **THEN** every roadmap item referencing it is deleted by the same operation, leaving no orphans

### Requirement: Deleting an item removes it, dropping retains it

Deleting a roadmap item SHALL remove it from the project's listing. Marking an item `dropped` SHALL
keep it and its order, so a dropped idea remains visible as one that was considered and set aside.

#### Scenario: Delete removes

- **WHEN** an item is deleted
- **THEN** it no longer appears in the project's roadmap

#### Scenario: Drop retains

- **WHEN** an item's status is set to `dropped`
- **THEN** it still appears in the project's roadmap with status `dropped`

### Requirement: A roadmap item carries the fields a ticket needs and may belong to a block

A roadmap item SHALL additionally hold:

- an optional block, one of its own project's blocks, unset meaning the item is loose;
- a markdown description, defaulting to empty, carrying what a created ticket's body will say,
  acceptance criteria included;
- a kind, one of the ticket kinds, defaulting to `change`;
- a priority, one of the ticket priorities, defaulting to `medium`; and
- an optional target role, one of its project's roles.

These fields SHALL be independent of the item's existing title, notes, order, status and linked
ticket, and an item that names a block, a target role or a linked ticket outside its own project
SHALL be refused as `not_found`.

An item created before blocks existed SHALL read back with its title, notes, order, status and
linked ticket unchanged, no block, an empty description, kind `change`, priority `medium` and no
target role.

#### Scenario: New fields round-trip

- **WHEN** an item is created or updated with a block, a description, a kind, a priority and a target
  role of its project
- **THEN** it is returned with those values and a later read shows them

#### Scenario: A pre-existing item still lists after the migration

- **WHEN** an item created before blocks existed is read after the migration
- **THEN** it lists with its original title, notes, status and order, no block and the field defaults

#### Scenario: A foreign block or role is refused

- **WHEN** an item names a block or a target role belonging to another project
- **THEN** the write is refused as `not_found` and the item is unchanged

### Requirement: A merge keeps a durable record of what it absorbed

Every merge of one pending ticket into another SHALL write a record holding the surviving item, the
merged item's id, its title and its description as they were at the merge, who merged it and when.
The record SHALL be stored and SHALL remain readable through the surviving item after the merged item
has been removed, and SHALL be removed with the surviving item if that item is ever deleted.

#### Scenario: The record outlives the merged item

- **WHEN** a merge completes and the merged item is removed
- **THEN** the surviving item still reports the record of what it absorbed

#### Scenario: The record goes with the survivor

- **WHEN** the surviving item is deleted
- **THEN** its merge records are deleted with it
