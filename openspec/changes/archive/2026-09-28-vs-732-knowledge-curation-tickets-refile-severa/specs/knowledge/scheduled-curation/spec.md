## MODIFIED Requirements

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

## ADDED Requirements

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
