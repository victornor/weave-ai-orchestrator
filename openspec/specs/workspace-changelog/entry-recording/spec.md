# workspace-changelog/entry-recording Specification

## Purpose
Defines the append-only record of what happened in a workspace and in each of its projects: which events become an entry, what an entry carries, that entries are never rewritten, that history already recorded is present without a backfill step, and that the record is kept entirely out of every agent's context because it is a record for the person who owns the workspace, not memory for the agents working in it.

## Requirements

### Requirement: The workspace keeps a changelog of what happened

The workspace SHALL keep a changelog: a time-ordered record of the events that mark work happening in the workspace. Each of these SHALL produce exactly one changelog entry:

- a ticket is filed
- a ticket's plan is approved
- a pull request is opened for a ticket
- a ticket's work lands
- a ticket is cancelled
- a role is hired
- the daemon is upgraded

An event that is not in this list SHALL NOT produce a changelog entry. Repeating an event SHALL produce one entry per occurrence, so a ticket that has two pull requests opened for it has two entries.

#### Scenario: A ticket is filed

- **WHEN** a ticket is created
- **THEN** the changelog has one entry for it, of the "ticket filed" kind

#### Scenario: Work lands

- **WHEN** a ticket's delivery lands and the ticket reaches its done status
- **THEN** the changelog has one entry of the "landed" kind for that ticket

#### Scenario: An event outside the list

- **WHEN** an event occurs that is not one of the listed kinds, such as a ticket being checked out by a worker or a knowledge entry being written
- **THEN** no changelog entry is produced for it

### Requirement: What an entry carries

Every changelog entry SHALL carry:

- an absolute timestamp, to the second, of when the event happened
- its kind, from the fixed set of kinds above
- the actor that caused it, identified as the human, the conductor, a named worker role, or the system
- the identifier of the ticket it concerns, when it concerns one
- a one-line summary in plain language
- a link target, when one exists: the ticket it concerns, or the pull request for an entry about a pull request

An entry about a ticket in a project SHALL carry that project. An entry that concerns no project, such as a daemon upgrade, SHALL carry none.

A summary SHALL be derived from the recorded event rather than stored separately, so that every surface showing the same entry shows the same summary.

#### Scenario: An entry for a landed ticket

- **WHEN** a changelog entry for a landed ticket is read
- **THEN** it carries the timestamp, the kind, the actor, the ticket identifier, a one-line summary and a link to the ticket

#### Scenario: An entry for an opened pull request

- **WHEN** a changelog entry for an opened pull request is read
- **THEN** its link target is the pull request's address

#### Scenario: An entry that concerns no project

- **WHEN** the daemon is upgraded and the resulting entry is read
- **THEN** the entry carries no project and no ticket identifier, and its actor is the human or the system that requested the upgrade

#### Scenario: The same entry on two surfaces

- **WHEN** the same entry is shown in the web app and printed by the command line
- **THEN** its one-line summary is identical in both

### Requirement: Project and workspace changelogs

The changelog SHALL be readable in two scopes: a single project's changelog, and the workspace changelog.

A project's changelog SHALL contain exactly the entries belonging to that project. The workspace changelog SHALL contain every entry in the workspace: every project's entries together with the entries that belong to no project.

Both scopes SHALL be ordered newest first, and SHALL be readable a page at a time so that a caller can load older history on demand rather than the whole record at once. Paging SHALL be stable: entries recorded while a caller is paging SHALL NOT cause an already-returned entry to be returned again or an older entry to be skipped.

#### Scenario: A project's changelog

- **WHEN** a project's changelog is read
- **THEN** it contains that project's entries and no entry belonging to another project

#### Scenario: The workspace changelog

- **WHEN** the workspace changelog is read
- **THEN** it contains every project's entries and the entries belonging to no project, interleaved in time order, newest first

#### Scenario: Loading older history

- **WHEN** a caller asks for the page of entries older than the last entry it received
- **THEN** it receives the next older entries, with no entry repeated and none skipped

#### Scenario: An entry recorded while paging

- **WHEN** a new entry is recorded between a caller's first and second page requests
- **THEN** the second page still continues from where the first ended, and the new entry is neither repeated in it nor causes an older entry to be skipped

### Requirement: The changelog is append-only

A changelog entry SHALL NOT be edited, rewritten, merged, summarised, curated, expired or deleted once recorded. No scheduled process SHALL prune it and no size limit SHALL apply to it: the changelog is allowed to grow without bound.

Correcting the record SHALL NOT be possible through any client. The changelog SHALL expose no write, edit or delete operation to the web app, the command line or any agent.

#### Scenario: No client can change an entry

- **WHEN** any client attempts to modify or delete a changelog entry
- **THEN** there is no operation that does so, and the record is unchanged

#### Scenario: Curation leaves it alone

- **WHEN** a curation run is scheduled or performed for the workspace
- **THEN** no changelog entry is rewritten, archived or removed

#### Scenario: Growth is not limited

- **WHEN** the changelog exceeds any size at which a knowledge file would be curated
- **THEN** no curation is scheduled for it, no entry is archived, and further entries are still recorded

### Requirement: The changelog is not a knowledge file and never reaches an agent

The changelog SHALL NOT be a knowledge file. It SHALL have no token budget, SHALL NOT appear in the knowledge listing, and SHALL NOT be reachable through any knowledge read, write, revision, revert, curation or search operation.

No changelog entry SHALL appear in any text given to an agent: not the bootstrap digest injected on an agent's first turn, not a worker's brief, not the conductor's context, and not any turn prompt. No agent-facing tool SHALL return changelog entries.

#### Scenario: An agent's bootstrap digest

- **WHEN** a worker's or the conductor's bootstrap digest is built for a workspace that has changelog entries
- **THEN** the digest contains no changelog entry, and its size is the same as it would be if the changelog were empty

#### Scenario: A worker's brief

- **WHEN** a worker's brief is prepared
- **THEN** it contains no changelog entry

#### Scenario: Knowledge surfaces ignore it

- **WHEN** knowledge files are listed, searched or curated
- **THEN** the changelog is absent from the results and no budget is reported for it

#### Scenario: No agent tool reaches it

- **WHEN** an agent calls any available tool
- **THEN** none of them returns a changelog entry

### Requirement: History already recorded is present

The changelog SHALL show the events the daemon has already recorded, from before the changelog existed, without an operator running a backfill step. Upgrading the daemon SHALL be enough for a workspace with existing history to show a populated changelog.

An entry derived from history SHALL carry the timestamp of the original event, not the time the changelog was first read.

#### Scenario: First read after an upgrade

- **WHEN** a workspace with months of recorded tickets, deliveries and hires is read for the first time after the daemon is upgraded
- **THEN** its changelog contains entries for that history, and no operator action was required

#### Scenario: A backfilled entry's timestamp

- **WHEN** an entry derived from an event recorded before the changelog existed is read
- **THEN** its timestamp is the time of the original event

### Requirement: Activity per day

The changelog SHALL be able to report, for a scope and a range of dates covering at least a year, how many entries fall on each day of that range, broken down by kind.

Days SHALL be bucketed in a timezone the caller names, so that the days reported match the days the reader sees. A day with no entries SHALL be reported as zero rather than omitted, so that the result covers the whole requested range.

One of the reported figures SHALL be the number of tickets that landed that day, which is the changelog's measure of a day's output.

#### Scenario: A year of days

- **WHEN** per-day activity is requested for a range of one year
- **THEN** every day in the range is present, days with no entries reporting zero

#### Scenario: Bucketing in the reader's timezone

- **WHEN** per-day activity is requested in a named timezone and an entry falls near midnight
- **THEN** the entry is counted on the day it falls on in that timezone, not the day it falls on elsewhere

#### Scenario: Landed tickets per day

- **WHEN** three tickets land on one day and one on the next
- **THEN** that day reports three landed and the next reports one

#### Scenario: Per-day activity for one project

- **WHEN** per-day activity is requested for a project
- **THEN** only that project's entries are counted
