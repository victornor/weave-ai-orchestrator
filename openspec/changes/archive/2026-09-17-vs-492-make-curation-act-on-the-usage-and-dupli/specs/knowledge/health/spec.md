## RENAMED Requirements

- FROM: `### Requirement: The health view derives four measures, on read, from existing records`
- TO: `### Requirement: The health view derives five measures, on read, from existing records`

## MODIFIED Requirements

### Requirement: The health view derives five measures, on read, from existing records

The daemon SHALL be able to report, for the workspace and for any one of its projects, without a new
stored record:

- every hub file's current size against its configured budget;
- every linked document with no other page linking to it;
- every linked document not written to in 90 days;
- every linked document that no run has read within the never-read window defined by
  `knowledge/scheduled-curation`, and that has existed at least as long as that window;
- every `[[link]]` recorded in a knowledge file or document that does not resolve to a page.

Each measure SHALL be computed from the file, document, link and read records the daemon already
keeps. Nothing SHALL be written to compute it, and the view SHALL reflect a write made immediately
before it is requested.

#### Scenario: An orphan document

- **WHEN** a project has a linked document that no other page links to
- **THEN** the health view for that project lists it among the documents with no backlink

#### Scenario: A stale document

- **WHEN** a project has a linked document that has not been written to in 90 days
- **THEN** the health view for that project lists it as not recently updated

#### Scenario: A never-read document

- **WHEN** a project has a linked document older than the never-read window that no run has read
- **THEN** the health view for that project lists it as never read

#### Scenario: A document read within the window

- **WHEN** a project has a linked document that a run has read within the never-read window
- **THEN** the health view does not list it as never read, whatever its age

#### Scenario: An unresolved link

- **WHEN** a knowledge file or document contains a `[[slug]]` that names no page in its resolvable
  scopes
- **THEN** the health view lists that link as unresolved, naming the page it appears in

#### Scenario: A hub file's size

- **WHEN** the health view is requested for a project
- **THEN** it reports that project's knowledge base's current size and its configured budget

#### Scenario: A write just before reading

- **WHEN** a knowledge write happens and the health view is requested immediately afterward
- **THEN** the view reflects that write

### Requirement: A project's knowledge health getting worse reaches the conductor before a write is rejected for it

The daemon SHALL periodically compare a project's current health measures against what they were at
the last comparison. When a new orphan, a new unresolved link, a document newly qualifying as a
never-read document, a newly appearing likely-duplicate pair, or a hub file newly past 80% of its
budget appears, or when the total number of open issues for that project reaches a fixed threshold,
the daemon SHALL wake the conductor naming the project and the issues found.

A likely-duplicate pair SHALL be reported to the conductor with both entries named and the file each
sits in, so the curator can decide what to merge. Reporting a pair SHALL NOT change it or any file.

This signal SHALL be raised on the same periodic sweep that already watches hub files for curation,
not only in response to a write that was rejected for being over budget. A hub file crossing 80% of
its budget SHALL reach the conductor through this signal whether or not anyone writes to it again
before the next sweep.

The first time a project's health is compared, no prior state SHALL be assumed empty: existing
issues at that first comparison SHALL be recorded as the starting point and SHALL NOT, by
themselves, wake the conductor.

#### Scenario: A new orphan appears

- **WHEN** a project's knowledge health is swept and a document that had a backlink at the previous
  sweep now has none
- **THEN** the conductor is woken, naming the project and the new orphan

#### Scenario: A document becomes a never-read document

- **WHEN** a project's knowledge health is swept and a linked document that was read within the
  window at the previous sweep is no longer read within it, and has reached the window's age
- **THEN** the conductor is woken, naming the project and the never-read document

#### Scenario: A likely-duplicate pair appears

- **WHEN** a project's knowledge health is swept and two of its existing entries are now at or above
  the duplicate threshold
- **THEN** the conductor is woken with both entries named and the file each sits in

#### Scenario: A hub file crosses its threshold with no rejected write

- **WHEN** a project's knowledge base crosses 80% of its configured budget between sweeps, with no
  write to it having been rejected
- **THEN** the conductor is woken about that project before any write to it is rejected

#### Scenario: The first sweep of a project

- **WHEN** a project's knowledge health is swept for the first time and it already has an orphan
  document
- **THEN** that orphan is recorded as the starting point and the conductor is not woken for it
