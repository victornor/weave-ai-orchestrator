# workspace-changelog/timeline-view Specification

## Purpose
Defines how the web app shows the workspace's changelog: a calendar heatmap of activity over the past year above a newest-first timeline separated by day, week and month, so the workspace owner can see at a glance when work happened and read what it was without loading the whole record.

## ADDED Requirements

### Requirement: The Knowledge area has a Changelog view

The web app's Knowledge area SHALL offer a Changelog view alongside its existing views. The view SHALL show the changelog of the project the reader has selected, and SHALL show the workspace changelog when no single project is selected.

Changing the selected project SHALL change the entries shown without leaving the view.

#### Scenario: Opening the Changelog view

- **WHEN** the reader opens the Changelog view with no project selected
- **THEN** the workspace changelog is shown

#### Scenario: Selecting a project

- **WHEN** the reader selects a project while in the Changelog view
- **THEN** that project's changelog is shown, and the view is not left

### Requirement: The timeline

Entries SHALL be listed newest first. Each entry SHALL show its time, its kind, its actor and its one-line summary, and SHALL link to the ticket it concerns or, for an entry about a pull request, to the pull request.

The list SHALL be separated so that the passage of time is readable: a separator SHALL begin each new day, and a heavier separator SHALL begin each new week and each new month. A separator SHALL name the period it begins.

Days SHALL be determined in the reader's own timezone, so that an entry appears under the date the reader would call it.

#### Scenario: An entry's link

- **WHEN** an entry concerning a ticket is activated
- **THEN** the reader is taken to that ticket

#### Scenario: An entry about a pull request

- **WHEN** an entry recording an opened pull request is activated
- **THEN** the reader is taken to that pull request

#### Scenario: Separators

- **WHEN** the timeline spans several days across a week boundary and a month boundary
- **THEN** each day begins with a day separator naming the date, and the first day of the new week and of the new month each additionally begin with a week and a month separator naming that period

#### Scenario: An empty changelog

- **WHEN** the selected scope has no entries
- **THEN** the view says so rather than showing an empty list

### Requirement: Older history loads on demand

The view SHALL load a page of recent entries first, and SHALL load older entries only when the reader asks for them or reaches the end of what is loaded. It SHALL NOT load the whole changelog at once.

While older entries are loading the view SHALL say so, and when there are no older entries it SHALL say that instead of offering to load more.

#### Scenario: Reaching the end of the loaded entries

- **WHEN** the reader reaches the end of the entries currently loaded and older entries exist
- **THEN** the next older page is loaded and appended, and the entries already read stay where they were

#### Scenario: The end of the record

- **WHEN** the oldest entry has been loaded
- **THEN** the view states that there is nothing older and offers no further loading

### Requirement: The activity heatmap

Above the timeline the view SHALL show a calendar-style grid of the last year or more, one cell per day, shaded by that day's activity. The scale SHALL be legible: days with no activity SHALL be visibly distinct from days with any, and the grid SHALL carry a legend showing what the shades mean.

The grid SHALL state, in the view, which measure it shades and what that measure means, so the reader never has to guess what a dark cell represents.

#### Scenario: A year of cells

- **WHEN** the Changelog view is shown
- **THEN** the heatmap covers at least the last year, one cell per day, aligned as a calendar grid

#### Scenario: The measure is stated

- **WHEN** the reader looks at the heatmap
- **THEN** the measure it shades and a one-line definition of it are visible in the view

#### Scenario: A day with no activity

- **WHEN** a day has no entries
- **THEN** its cell is shown in the empty shade rather than omitted from the grid

### Requirement: A day's detail and jumping to it

Pointing at or tapping a day's cell SHALL show that day's detail: the date and the counts behind it, including the number of tickets that landed.

Activating a day's cell SHALL move the timeline to that day, so the reader can read what happened. If that day's entries are not yet loaded, they SHALL be loaded before the timeline moves.

#### Scenario: Hovering a day

- **WHEN** the reader points at a day's cell
- **THEN** that day's date and its counts, including tickets landed, are shown

#### Scenario: Tapping a day on a touch screen

- **WHEN** the reader taps a day's cell on a device with no pointer
- **THEN** that day's detail is shown

#### Scenario: Jumping to a day already loaded

- **WHEN** the reader activates a day whose entries are loaded
- **THEN** the timeline scrolls to that day's separator

#### Scenario: Jumping to a day not yet loaded

- **WHEN** the reader activates a day older than everything loaded
- **THEN** the entries up to that day are loaded and the timeline then scrolls to it
