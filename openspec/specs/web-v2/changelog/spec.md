# web-v2/changelog Specification

## Purpose
The V2 Changelog screen: the workspace's record — tickets filed, plans approved, pull requests opened,
work landed, hires and upgrades — as a year heatmap above a newest-first timeline, in V2's Mono language.
It is the kept V1 Changelog restyled, with the same content.

## Requirements

### Requirement: A heatmap over a newest-first, time-grouped timeline

The screen SHALL show the changelog heatmap for the last year and the entries newest first, grouped by
day, week and month, derived from the shared timeline grouping the daemon also buckets the heatmap with,
so a heatmap cell and the timeline separator it moves to mean the same day. Choosing a heatmap cell
SHALL move the timeline to that day, loading older entries first if that day is not yet loaded.

#### Scenario: The timeline is grouped

- **WHEN** the changelog has entries
- **THEN** they are shown newest first, separated by day, with week and month headings at their
  boundaries

#### Scenario: A heatmap cell moves the timeline

- **WHEN** the human chooses a day in the heatmap
- **THEN** the timeline moves to that day, loading older entries first if it is not yet loaded

#### Scenario: Nothing has happened

- **WHEN** the workspace has no changelog entries
- **THEN** the screen shows an empty state explaining what will appear

### Requirement: Entries carry their kind and link to what they are about

Each entry SHALL show its time, its kind with the shared kind vocabulary, its summary and the actor, and
SHALL link to the ticket it concerns, or open the pull request on the forge for an entry that has one.
An entry that concerns no ticket SHALL read as plain.

#### Scenario: A ticket entry links to the ticket

- **WHEN** an entry concerns a ticket
- **THEN** it links to that ticket's V2 page

#### Scenario: A pull request entry opens the forge

- **WHEN** an entry carries a pull request
- **THEN** activating it opens that pull request on the forge in a new tab

#### Scenario: An entry with no link

- **WHEN** an entry concerns no ticket and no pull request
- **THEN** it renders as a plain row with its time, kind, summary and actor

### Requirement: Older entries load on demand

The screen SHALL load older entries only when the human asks for them or when the timeline is moved to a
day older than what is loaded, and it SHALL say plainly when the whole record has been reached.

#### Scenario: Loading older entries

- **WHEN** the human asks for older entries and more exist
- **THEN** the next page loads and appends below the newest-first list

#### Scenario: The whole record is shown

- **WHEN** no older entries exist
- **THEN** the screen says the record is complete rather than offering a load control
