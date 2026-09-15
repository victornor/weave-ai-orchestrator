## ADDED Requirements

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
