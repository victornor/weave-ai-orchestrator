# workspace-changelog/changelog-cli Specification

## Purpose
Defines how the workspace owner reads the changelog from a terminal: printing a project's or the whole workspace's record for a chosen range of dates, in a form that is readable at a glance and portable enough to keep.

## ADDED Requirements

### Requirement: Printing a changelog

The command line SHALL print a changelog. Without a project it SHALL print the workspace changelog; given a project it SHALL print that project's.

Entries SHALL be printed newest first, each showing its timestamp, its kind, its actor, the ticket identifier when it has one and its one-line summary. The summary SHALL be the same one the web app shows for that entry.

#### Scenario: The workspace changelog

- **WHEN** the changelog is printed with no project given
- **THEN** every project's entries and the entries belonging to no project are printed together, newest first

#### Scenario: A project's changelog

- **WHEN** the changelog is printed for a project
- **THEN** only that project's entries are printed

#### Scenario: An unknown project

- **WHEN** the changelog is printed for a project that does not exist
- **THEN** it fails with an error naming the project, and prints no entries

### Requirement: A date range

The command SHALL accept a start date, an end date, or both, and SHALL print only the entries falling in that range. Given neither, it SHALL print a recent default range rather than the entire record.

A range SHALL be interpreted in the machine's own timezone, so that asking for a day prints the entries of that day as the reader would count it. A start later than the end SHALL be rejected with a message saying so.

#### Scenario: Both ends given

- **WHEN** a start and an end date are given
- **THEN** only entries falling between them, inclusive of both days, are printed

#### Scenario: Only a start given

- **WHEN** only a start date is given
- **THEN** entries from that date up to now are printed

#### Scenario: No range given

- **WHEN** no dates are given
- **THEN** a recent default range is printed and the command states the range it used

#### Scenario: An inverted range

- **WHEN** the start is later than the end
- **THEN** the command fails saying so and prints no entries

### Requirement: Machine-readable output

The command SHALL support the same machine-readable output the workspace's other read commands support, emitting the entries with their fields rather than the formatted lines.

#### Scenario: Machine-readable output

- **WHEN** the changelog is printed with machine-readable output requested
- **THEN** the entries are emitted with their timestamp, kind, actor, project, ticket identifier, summary and link, and no decorative formatting
