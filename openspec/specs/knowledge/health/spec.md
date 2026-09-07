# knowledge/health Specification

## Purpose
Describes the knowledge network's health view: the four measures that show whether the network is
reachable and current rather than accumulating silently, where they are shown, and how a project
getting worse reaches the conductor before a write to it is ever rejected.

## Requirements

### Requirement: The health view derives four measures, on read, from existing records

The daemon SHALL be able to report, for the workspace and for any one of its projects, without a new
stored record:

- every hub file's current size against its configured budget;
- every linked document with no other page linking to it;
- every linked document not written to in 90 days;
- every `[[link]]` recorded in a knowledge file or document that does not resolve to a page.

Each measure SHALL be computed from the file, document and link records the daemon already keeps.
Nothing SHALL be written to compute it, and the view SHALL reflect a write made immediately before
it is requested.

#### Scenario: An orphan document

- **WHEN** a project has a linked document that no other page links to
- **THEN** the health view for that project lists it among the documents with no backlink

#### Scenario: A stale document

- **WHEN** a project has a linked document that has not been written to in 90 days
- **THEN** the health view for that project lists it as not recently updated

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

### Requirement: The health view is reachable as a route and as a section of the project overview

The health view SHALL be reachable as a request scoped to the whole workspace and as a request
scoped to one project. The project overview SHALL show, for that project, its orphan documents, its
stale documents and its unresolved links, each linking into the knowledge area filtered to it.

A project with none of an issue SHALL show that plainly rather than omitting the measure.

#### Scenario: Requesting the workspace view

- **WHEN** the health view is requested with no project named
- **THEN** every hub file's size and budget is reported, across every project

#### Scenario: Requesting one project's view

- **WHEN** the health view is requested for one project
- **THEN** only that project's hub file, its documents and the links reachable from them are
  reported

#### Scenario: A healthy project

- **WHEN** a project has no orphan document, no stale document and no unresolved link
- **THEN** its overview says so for each measure rather than omitting the section

### Requirement: A project's knowledge health getting worse reaches the conductor before a write is rejected for it

The daemon SHALL periodically compare a project's current health measures against what they were at
the last comparison. When a new orphan, a new unresolved link, or a hub file newly past 80% of its
budget appears, or when the total number of open issues for that project reaches a fixed threshold,
the daemon SHALL wake the conductor naming the project and the issues found.

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

#### Scenario: A hub file crosses its threshold with no rejected write

- **WHEN** a project's knowledge base crosses 80% of its configured budget between sweeps, with no
  write to it having been rejected
- **THEN** the conductor is woken about that project before any write to it is rejected

#### Scenario: The first sweep of a project

- **WHEN** a project's knowledge health is swept for the first time and it already has an orphan
  document
- **THEN** that orphan is recorded as the starting point and the conductor is not woken for it

### Requirement: An unchanged or improving network stays silent

When a project's health measures at a sweep are the same as, or better than, the last comparison,
the daemon SHALL NOT wake the conductor about that project's knowledge health.

#### Scenario: Nothing changed

- **WHEN** a project's knowledge health is swept and every measure is unchanged since the last sweep
- **THEN** the conductor is not woken about that project's knowledge health

#### Scenario: An issue was fixed

- **WHEN** a document that was orphaned at the last sweep now has a backlink
- **THEN** the conductor is not woken, and the fixed document is no longer counted at the next
  comparison
