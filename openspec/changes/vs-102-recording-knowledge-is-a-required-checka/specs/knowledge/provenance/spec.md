## Purpose
Describes how a knowledge write records the ticket that produced it, alongside the author it
already records, so a future reader can trace a claim in a knowledge file or document back to the
work that established it.

## ADDED Requirements

### Requirement: A knowledge write made from a ticket's work records that ticket

Every note and every document write made by a worker or a conductor during a ticket's work SHALL
record which ticket it came from, in addition to the author it already records. This SHALL apply to
writes made from the point this capability exists forward.

#### Scenario: A note written while working a ticket

- **WHEN** a worker writes a knowledge note while it holds a ticket
- **THEN** the recorded revision carries that ticket, alongside the agent that wrote it

#### Scenario: A document written while working a ticket

- **WHEN** a worker writes a linked document while it holds a ticket
- **THEN** the recorded revision carries that ticket

### Requirement: A write with no ticket behind it records none

A write made with no ticket in progress — a human editing a knowledge file directly, or the daemon
seeding or correcting a file on its own — SHALL record no ticket, rather than a guessed or
placeholder one.

#### Scenario: A human edit

- **WHEN** a human edits a knowledge file directly, outside any ticket
- **THEN** the recorded revision carries no ticket

#### Scenario: A daemon-seeded file

- **WHEN** the daemon seeds or corrects a knowledge file's stated budget on its own
- **THEN** the recorded revision carries no ticket

### Requirement: Existing revisions are left exactly as they were

Recording a ticket on new writes SHALL NOT alter, backfill, or infer a ticket for any revision
recorded before this capability existed. A revision with no ticket recorded SHALL continue to have
none.

#### Scenario: A revision from before this capability

- **WHEN** a knowledge file's revision history includes revisions written before ticket provenance
  was recorded
- **THEN** those revisions are unchanged and continue to show no ticket

### Requirement: A revision's ticket is visible wherever its history is read

Reading a knowledge file's or a document's revision history SHALL include the ticket recorded on
each revision that has one, in a form that opens that ticket.

#### Scenario: Reading history

- **WHEN** a knowledge file's revision history is read
- **THEN** each revision that recorded a ticket shows it, opening that ticket
