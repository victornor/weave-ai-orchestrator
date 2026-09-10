# incidents/global-page Specification

## Purpose
A daemon-wide Incidents page that lists every system incident agents have filed, separated into conductor vs worker, reachable without picking a workspace first.

## Requirements

### Requirement: A global Incidents page lists persisted incidents

The web app SHALL provide an addressable Incidents page at a path that does not include a workspace id (`/incidents`), reachable from the sidebar's global section and from the phone's More menu, without typing a URL and without first choosing a workspace.

The page SHALL show every persisted incident, newest first. Each row SHALL show at least the title, reporter kind, when it was filed, and the workspace it was filed from when one is stored. Expanding or opening a row SHALL show whatFailed, tryingToDo, and evidence when present.

Opening the page SHALL NOT make a workspace active and SHALL NOT rewrite the workspace remembered for the next launch.

There SHALL NOT be a per-workspace Incidents page. Per-workspace Needs you, Live, Chat, Board and the rest SHALL keep working unchanged. The page SHALL NOT replace tickets or Needs you.

#### Scenario: Opening global Incidents from the sidebar

- **WHEN** the human activates Incidents in the sidebar's global section
- **THEN** the app shows the global Incidents page without a document reload and without making a workspace the active one

#### Scenario: Opening global Incidents from a phone

- **WHEN** the human opens More on a phone and chooses the global Incidents destination
- **THEN** the app shows the global Incidents page and the menu is dismissed

#### Scenario: A filed incident appears

- **WHEN** a worker has filed an incident and the human opens global Incidents
- **THEN** the page shows that incident's title, that it was filed by a worker, and when

#### Scenario: Detail is available on the page

- **WHEN** an incident with whatFailed, tryingToDo, and evidence is shown
- **THEN** the human can read those three fields on the page without leaving it

#### Scenario: Per-workspace pages are unchanged

- **WHEN** the human activates Needs you inside a workspace group's section list
- **THEN** the app shows that workspace's Needs you page, not Incidents

### Requirement: The page separates conductor incidents from worker incidents

The page SHALL let the human see conductor-filed incidents separately from worker-filed incidents. It SHALL offer a filter or grouping with at least: all incidents, conductor only, and worker only. Choosing conductor-only SHALL hide worker incidents; choosing worker-only SHALL hide conductor incidents.

#### Scenario: Filter to conductor

- **WHEN** the list contains one conductor incident and one worker incident and the human chooses conductor
- **THEN** the page shows the conductor incident and not the worker incident

#### Scenario: Filter to worker

- **WHEN** the list contains one conductor incident and one worker incident and the human chooses worker
- **THEN** the page shows the worker incident and not the conductor incident

#### Scenario: All shows both

- **WHEN** the list contains one conductor incident and one worker incident and the filter is all
- **THEN** the page shows both, each labelled with its reporter kind

### Requirement: Empty, loading and error states

While incidents have not yet loaded, the page SHALL show a loading state distinguishable from empty. When the list has loaded and there are no incidents (or none matching the current filter), the page SHALL show a worded empty state. When the list cannot be loaded, the page SHALL show an error and a way to retry; it SHALL NOT render as though there are simply no incidents.

#### Scenario: Nothing has been filed

- **WHEN** the incidents list has loaded and is empty
- **THEN** the page says so in words, with no rows

#### Scenario: The filter matches nothing

- **WHEN** only worker incidents exist and the human chooses conductor
- **THEN** the page says there are no conductor incidents, with no worker rows

#### Scenario: The list fails to load

- **WHEN** the incidents list request fails
- **THEN** the page shows that it could not load, with a way to retry, and does not show the empty-list wording
