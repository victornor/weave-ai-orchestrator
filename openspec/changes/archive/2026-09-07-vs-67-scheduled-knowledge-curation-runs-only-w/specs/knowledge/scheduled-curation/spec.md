## ADDED Requirements

### Requirement: A scheduled curation run is asked for from the file's current numbers

The daemon SHALL sweep a workspace's knowledge files periodically and ask for a curation run only
for a file that is past its share of the budget currently configured for its scope, or that was last
curated longer ago than the staleness window.

Whether a file is past its share SHALL be derived, at the time of the sweep, from the file's recorded
size against the configured budget. A verdict recorded on the file by an earlier write SHALL NOT be
what the sweep acts on: a budget raised since that write, or a curation run that has happened since,
SHALL be enough for the file to be left alone. When the recorded verdict or the recorded budget
disagrees with the configured one, the daemon SHALL correct the record, without changing when the
file was last written.

#### Scenario: A file flagged under a budget that has since been raised

- **WHEN** a knowledge file was recorded as needing curation because it was past its share of the
  budget then in force, and the workspace has since raised that budget above the file's size
- **THEN** no curation run is asked for, and the file is no longer recorded as needing one

#### Scenario: A file that has grown past its share

- **WHEN** a knowledge file is past its share of the configured budget for its scope
- **THEN** a curation run is asked for and the file is recorded as needing one

#### Scenario: A file curated within the window and under its share

- **WHEN** a project's knowledge base has been curated and a day passes with no file past its share
  of its budget
- **THEN** no curation run is asked for that project

#### Scenario: A file not curated for the whole staleness window

- **WHEN** a knowledge file's last curation is older than the staleness window
- **THEN** a curation run is asked for it, whatever its size

### Requirement: A curation run clears the flag for the scope it was asked for

A curation run is asked for a scope, not for a single file: it produces one curation ticket covering
that scope's knowledge. When a curation write completes for a scope, the daemon SHALL clear the
"needs curation" record on every knowledge file in that scope and project, not only on the file the
curation rewrote.

#### Scenario: A linked document the curator did not rewrite

- **WHEN** a project's knowledge base is curated while a linked document in the same project is
  recorded as needing curation
- **THEN** that document is no longer recorded as needing curation

### Requirement: A knowledge row with no file behind it is skipped

A knowledge file that exists only as a record — its file deleted, archived, renamed, or never
written — SHALL NOT have a curation run asked for it, however long ago it was last curated.

#### Scenario: A record whose file is gone

- **WHEN** the sweep reaches a knowledge record whose file is not on disk and whose last curation is
  older than the staleness window
- **THEN** no curation run is asked for it

### Requirement: Every scheduled curation request is logged with its evidence

Each curation run the sweep asks for SHALL be logged with the file's path, its scope, which condition
caused it — past its share of the budget, or stale — the file's size, the budget in force, and the
time the staleness was measured from. A request that fails SHALL be logged with the same evidence and
the failure.

#### Scenario: Diagnosing a request from the log alone

- **WHEN** the sweep asks for a curation run
- **THEN** the log line names the file, the condition, the size against the budget, and the time the
  staleness was measured from, without any other source being needed
