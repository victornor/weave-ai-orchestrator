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
curation rewrote. It SHALL also reset the scope's staleness reference — the time from which the
staleness window is measured — for every file in that scope, so a file the curation did not rewrite
does not immediately qualify as stale again on the next sweep. A document a run read during that
curation turn is already excluded from the never-read condition by `A document nobody has read is a
curation condition`, and the interval in `A scope is not asked for curation again within the
interval` keeps the scope from being asked again before the turn's effect is visible.

#### Scenario: A linked document the curator did not rewrite

- **WHEN** a project's knowledge base is curated while a linked document in the same project is
  recorded as needing curation
- **THEN** that document is no longer recorded as needing curation

#### Scenario: A file the curator did not rewrite is not immediately stale again

- **WHEN** a curation run completes for a scope whose staleness reference for every file in it is
  reset to the completion time
- **THEN** no file in that scope qualifies as stale on the very next sweep

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

### Requirement: Per-file curation conditions collapse into one request per scope

The periodic sweep SHALL evaluate the curation condition of every knowledge file, but SHALL make at
most one curation request per scope and project in a pass, covering every file in that scope that
qualified. A file that qualifies SHALL still be logged with its own evidence — its path, its scope,
which condition made it qualify, its size, the budget in force, and the time staleness was measured
from — even when its scope's single request was raised by a different file.

#### Scenario: Several files due in one project produce one request

- **WHEN** a project has several stale or never-read files at once
- **THEN** exactly one curation request is made for that project, and each qualifying file is logged
  with its own condition

#### Scenario: Two projects due in the same pass

- **WHEN** two different projects each have at least one file that qualifies in the same sweep
- **THEN** one curation request is made for each project

#### Scenario: The request names the scope, not one file

- **WHEN** a curation request is made because several files in a scope qualified
- **THEN** the request is for the scope as a whole and is not repeated once per qualifying file

### Requirement: A scope is not asked for curation again within the interval

The daemon SHALL ask for at most one curation run for a given scope and project at a time, and SHALL
NOT ask for another for the same scope and project within a minimum interval after the last one was
requested or completed. The minimum interval SHALL be a stated constant, with the reasoning for its
duration written in code. A scope with no file that qualifies SHALL NOT be asked for a run whatever
the interval.

#### Scenario: A second sweep inside the interval files nothing

- **WHEN** a curation run has been requested or completed for a project and the sweep runs again
  before the minimum interval has elapsed
- **THEN** no curation run is asked for that project, even though a file in it still qualifies

#### Scenario: A run already open is not duplicated

- **WHEN** a curation run for a project is open and the sweep finds another file in that project
  that qualifies
- **THEN** no second curation run is asked for that project

#### Scenario: A different project is unaffected

- **WHEN** one project has just been curated and another project has a file that qualifies
- **THEN** the other project is asked for a curation run as normal

#### Scenario: A workspace-scope file is capped the same way

- **WHEN** a workspace-scope knowledge file qualifies and a curation request for that scope has
  already been made within the minimum interval
- **THEN** no second request is made for that scope

### Requirement: A manual request or a hard over-budget rejection bypasses the interval

A request made because a human asked for curation directly, and a request made because a knowledge
write was rejected for putting a file over its configured budget, SHALL bypass the minimum interval
and ask for a curation run. They SHALL NOT create a second curation run while one for the same scope
and project is already open. The soft condition — a write that brings a file past its share of the
budget without being rejected — SHALL NOT bypass the interval.

#### Scenario: A manual curate inside the interval still files

- **WHEN** a human asks for a project's knowledge to be curated before the minimum interval has
  elapsed since the last run
- **THEN** a curation run is asked for that project

#### Scenario: A rejected over-budget write inside the interval still files

- **WHEN** a knowledge write is rejected for putting a file over its configured budget before the
  minimum interval has elapsed since the last curation run for that scope
- **THEN** a curation run is asked for that scope

#### Scenario: The soft over-share condition respects the interval

- **WHEN** a write brings a file past its share of the budget without being rejected, inside the
  minimum interval since the last curation run for that scope
- **THEN** no additional curation run is asked for that scope

#### Scenario: Bypassing the interval does not open a second ticket

- **WHEN** a manual request or an over-budget rejection bypasses the interval while a curation run
  for that scope is already open
- **THEN** no second curation run is created for that scope

### Requirement: A curation ticket that finishes without a write still counts as curated

When a curation ticket for a project reaches `done`, the daemon SHALL, whether or not the curator wrote anything, set the staleness reference to now and clear the "needs curation" record on every knowledge file in that project's scope, and restart the scope's interval. A curation ticket that is cancelled SHALL leave the staleness reference and records unchanged. A workspace-scope curation has no ticket and SHALL keep resetting freshness only when a curation write happens.

#### Scenario: A curation that changes nothing

- **WHEN** a project's curation ticket ends `done` with no knowledge write, and its documents had never been curated and are older than the staleness window
- **THEN** no file in that scope qualifies as stale on the next sweep, and no second curation ticket is filed until the staleness window has passed again

#### Scenario: A cancelled curation

- **WHEN** a project's curation ticket ends `cancelled`
- **THEN** the files' staleness reference and needs-curation records are unchanged

### Requirement: A project that cannot be curated is reported once per interval

When a scheduled curation request fails because the project has no active role to curate it, the daemon SHALL treat the scope as asked for the purpose of the interval, so the failure is logged once per interval rather than on every sweep. A manual request SHALL still report the failure every time.

#### Scenario: A project with no role

- **WHEN** the sweep repeatedly finds a stale scope in a project with no active role
- **THEN** the failure is logged once, and later sweeps within the interval are suppressed
