## ADDED Requirements

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
