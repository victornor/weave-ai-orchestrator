# web-v2/needs-you Specification

## Purpose
The global V2 Needs you screen: every open human decision across workspaces, filtered by scope and by
decision kind, with header counts that come from the same query the list renders.

## Requirements

### Requirement: Needs you lists real open decisions across workspaces

The V2 screen at `/v2/needs` SHALL list the open decisions owned by the human across every workspace,
most recent first within each workspace, and SHALL render each as the complete V2 decision card. An
empty list SHALL show an empty state rather than a broken or blank screen.

#### Scenario: Decisions from every workspace

- **WHEN** two workspaces each have an open human decision
- **THEN** both appear on `/v2/needs` as full decision cards

#### Scenario: Nothing waiting

- **WHEN** no workspace has an open human decision
- **THEN** the screen shows an empty state

### Requirement: Scope and kind filters filter for real

The filter row SHALL lead with scope filters — `Everywhere` followed by each workspace — and SHALL
then offer decision-kind chips. Choosing a scope SHALL show only that scope's decisions; choosing a
kind chip SHALL show only decisions of that kind; combining them SHALL apply both. The screen reached
through a workspace's Needs you SHALL open with that workspace's scope pre-applied, and the screen
reached at `/v2/needs` SHALL open on `Everywhere`.

#### Scenario: Filter by workspace

- **WHEN** the human chooses one workspace's scope filter
- **THEN** only that workspace's decisions are listed

#### Scenario: Filter by kind

- **WHEN** the human chooses a decision-kind chip
- **THEN** only decisions of that kind are listed

#### Scenario: The workspace shortcut pre-applies scope

- **WHEN** the human opens a workspace's Needs you
- **THEN** the screen opens with that workspace's scope filter already applied

### Requirement: Every count comes from the same query the list renders

The header count and any per-scope count the screen shows SHALL be derived from the same decision
query the list renders, never from a separate literal or a second fetch. A count must not be able to
disagree with the number of cards the active filter shows.

#### Scenario: The header agrees with the list

- **WHEN** the screen shows a count of waiting decisions
- **THEN** it equals the number of cards the same filtered list renders

#### Scenario: Filtering changes the count

- **WHEN** the human narrows the scope or kind filter
- **THEN** the count and the list change together
