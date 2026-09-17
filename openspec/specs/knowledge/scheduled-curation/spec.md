# knowledge/scheduled-curation Specification

## Purpose
Makes scheduled knowledge curation run only when the numbers justify it: a run is requested from the
file's current size and pending state, clears the flag for the scope it was asked for, skips a stale
row whose file is gone, and logs the evidence behind every request.

## Requirements

### Requirement: A scheduled curation run is asked for from the file's current numbers

The daemon SHALL sweep a workspace's knowledge files periodically and ask for a curation run only
for a file that is past its share of the budget currently configured for its scope, for a file that
was last curated longer ago than the staleness window, or for a linked document that is a never-read
document under `A document nobody has read is a curation condition`.

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

#### Scenario: A never-read document

- **WHEN** the sweep reaches a linked document older than the never-read window that no run has read
- **THEN** a curation run is asked for that document's scope

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
caused it — past its share of the budget, stale, or a never-read document — the file's size, the
budget in force, and the time the staleness was measured from. A request that fails SHALL be logged
with the same evidence and the failure.

#### Scenario: Diagnosing a request from the log alone

- **WHEN** the sweep asks for a curation run
- **THEN** the log line names the file, the condition, the size against the budget, and the time the
  staleness was measured from, without any other source being needed

#### Scenario: Diagnosing a never-read request

- **WHEN** the sweep asks for curation because a document nobody has read is old enough
- **THEN** the log line names the document, the never-read condition, and the window it was measured
  against

### Requirement: A document nobody has read is a curation condition

The daemon SHALL treat a linked document that no run has read within a configured window as a
condition for curation, alongside a file past its share of the budget and a file whose last curation
is older than the staleness window. The window SHALL be a workspace setting expressed in days, with a
stated default, and the reasoning for that default SHALL be written down in code rather than implied.

A document SHALL NOT be reported for this condition before it is as old as the window, so a document
created during the window is not flagged merely for being new. A document read by any run within the
window SHALL NOT be reported for this condition, whatever its age.

The condition SHALL be derived from the read events the daemon already records
(`knowledge/context-accounting`), never from a second, parallel notion of a read.

#### Scenario: A document no run has read

- **WHEN** a linked document is older than the never-read window and no read event ever recorded a run
  reading it
- **THEN** curation is asked for its scope, and the document is reported as a never-read document

#### Scenario: A document read recently

- **WHEN** a linked document was read by a run within the never-read window, however old the document is
- **THEN** it is not reported as a never-read document and its read does not by itself ask for curation

#### Scenario: A document newer than the window

- **WHEN** a linked document was created within the never-read window and no run has read it yet
- **THEN** it is not reported as a never-read document

#### Scenario: The window is a stated workspace setting

- **WHEN** the never-read window is read from the workspace configuration
- **THEN** it has a documented default, and a workspace that set its own value uses that value

### Requirement: A bounded sweep surfaces near-duplicate entries without changing anything

The daemon SHALL periodically compare the existing entries within a scope with each other and
report pairs at or above the existing `DUPLICATE_THRESHOLD` of 0.8. The sweep SHALL use the existing
entry normalization and a comparison that requires meaningful shared content on both sides; a high
score SHALL NOT be awarded solely because a short entry is contained in a longer entry. The sweep
SHALL exclude entries with fewer than two words or fewer than 12 non-whitespace characters, and SHALL
exclude hub-file section-pointer lines whose text begins with a `[[slug]]` link and acts as a
one-line pointer to a linked document.

The sweep SHALL only report. It SHALL NOT edit, merge, archive or delete any entry, file or document.

The sweep SHALL be bounded: the number of entries it compares SHALL be capped at a fixed maximum, so
its cost is bounded by that cap and does not grow without limit as the corpus grows. A corpus larger
than the cap SHALL be swept up to it, and that the sweep was capped SHALL be visible in its output or
log rather than silent.

The minimum-content floor is deliberately the smallest floor that removes the reported one-word
`**Status:**` false positives while preserving the real two-word near-duplicate entries that the
knowledge system must still surface. The character floor prevents punctuation-only or similarly
contentless short variants from bypassing the word floor.

#### Scenario: Two entries that drifted together

- **WHEN** two existing entries within one scope pass the minimum-content and hub-pointer filters and are at or above the duplicate threshold
- **THEN** the pair is reported, naming both entries and the file each sits in

#### Scenario: A short boilerplate entry

- **WHEN** an entry contains only the real `**Status:**` boilerplate fragment from `workspace/docs/self-hosted-ci-runner.md`
- **THEN** it is not compared or reported as a duplicate of unrelated project prose

#### Scenario: A contained fragment and unrelated prose

- **WHEN** a short entry shares only a common word or short phrase with a longer unrelated entry
- **THEN** the pair is not reported solely because the shorter text is contained in the longer text

#### Scenario: A repeated hub section pointer

- **WHEN** a project hub contains the same `[[daemon-test-suite]] — ...` pointer in both `Landmines` and `Documents`
- **THEN** the pair is not reported as a duplicate

#### Scenario: A genuine near-duplicate remains visible

- **WHEN** two real knowledge entries state the same gateway retry fact with one entry adding only a trailing qualifier
- **THEN** the pair is reported with both entries and its score

#### Scenario: The sweep changes nothing

- **WHEN** the duplicate sweep runs
- **THEN** no knowledge file, entry or document is written, merged, archived or deleted, and the only output is the reported pairs

#### Scenario: A corpus larger than the cap

- **WHEN** a scope holds more entries than the sweep's cap
- **THEN** the sweep compares at most that many and reports that it was capped, rather than comparing every pair
