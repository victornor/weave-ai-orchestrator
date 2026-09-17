# knowledge/provenance Specification

## Purpose
Describes how a knowledge write records the ticket that produced it, alongside the author it
already records, so a future reader can trace a claim in a knowledge file or document back to the
work that established it.

## Requirements

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

### Requirement: A curated replacement records the claims it supersedes

A curated replacement of a knowledge file SHALL be able to name the specific existing claims it
supersedes — the entries the new content corrects or replaces — and the daemon SHALL record them on
the revision it writes, alongside the entries it already archives.

A named claim SHALL exist in the file being replaced; a replacement naming a claim that is not there
SHALL be rejected rather than recording an invented or unresolvable supersession.

The supersession SHALL be additive provenance. It SHALL NOT change what is archived, SHALL NOT alter
the replacement body the caller supplied, and SHALL NOT delete anything.

#### Scenario: A replacement says what it supersedes

- **WHEN** a curated replacement names an entry that exists in the file it replaces
- **THEN** the written revision records that entry as superseded by the replacement

#### Scenario: A replacement names a claim that is not in the file

- **WHEN** a curated replacement names a claim that no entry of the file matches
- **THEN** the write is rejected with the unmatched claim named, and no revision is written

#### Scenario: A replacement with no supersession

- **WHEN** a curated replacement names no claim to supersede
- **THEN** the revision records no supersession, exactly as today

#### Scenario: Superseding does not change the archive or the body

- **WHEN** a curated replacement records a supersession
- **THEN** the entry is still archived as before, and the body written is exactly the one supplied

### Requirement: A recorded supersession is visible wherever a revision's history is read

Reading a knowledge file's or a document's revision history SHALL include the claims that revision
recorded as superseded, so a reader can see that a fact was corrected rather than quietly dropped.

#### Scenario: Reading history after a supersession

- **WHEN** a knowledge file's revision history is read and a revision recorded a supersession
- **THEN** that revision shows the claim it superseded
