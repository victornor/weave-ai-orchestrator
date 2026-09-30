## ADDED Requirements

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
