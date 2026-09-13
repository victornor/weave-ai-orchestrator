# web-v2/live Specification

## Purpose
The global V2 Live floor: every live worker across workspaces as a grid of trace feeds, with real
scope filtering, a per-row density control, and counts that come from the same query the grid
renders.

## Requirements

### Requirement: Live lists live workers across every workspace

The V2 screen at `/v2/live` SHALL list every worker that is on a ticket in a live status across all
workspaces, each as a card carrying that worker's current run feed, and SHALL exclude weavers and
workers that are not live. An empty roster SHALL show an empty state rather than a blank grid. A
worker whose turn has ended SHALL keep its most recent turn's feed on screen until a new turn starts.

#### Scenario: Workers from multiple workspaces

- **WHEN** two workspaces each have a worker running a turn
- **THEN** both appear as cards on `/v2/live`, each streaming its own run

#### Scenario: The conductor is not a cell

- **WHEN** a workspace's weaver is running a turn
- **THEN** it does not appear as a Live card

#### Scenario: Between turns

- **WHEN** a worker's turn ends and no new turn has started
- **THEN** its card keeps showing that last turn rather than going blank

### Requirement: Scope chips filter and the counts come from one source

The filter row SHALL offer `Everywhere` followed by each workspace, and choosing one SHALL show only
that scope's live workers. The header SHALL state the roster and what is currently shown as two
distinctly-phrased figures (`6 running · showing 2`), both derived from the same worker data the grid
renders, so they cannot disagree.

#### Scenario: Filter by workspace

- **WHEN** the human chooses one workspace's scope chip
- **THEN** only that workspace's live workers are shown

#### Scenario: The shown count agrees with the grid

- **WHEN** the scope filter hides some workers
- **THEN** the shown figure equals the number of cards rendered, and the roster figure is unchanged

### Requirement: The per-row control changes the layout and the feed height

On desktop the grid SHALL show two cards per row by default and SHALL offer a `−/+` control that sets
one to four cards per row. The feed height SHALL scale inversely with the column count — 420, 300,
240 and 200px for one, two, three and four per row — and the chosen density SHALL persist across
reloads. On phone the grid SHALL always be one column and the control SHALL not be shown.

#### Scenario: Fewer per row means taller feeds

- **WHEN** the human steps the control from two per row to one per row
- **THEN** the grid renders one column and the feed height becomes 420px

#### Scenario: The choice persists

- **WHEN** the human sets a density and reloads the app
- **THEN** the grid opens at that density

#### Scenario: Phone is one column

- **WHEN** the screen is at phone width
- **THEN** the grid is a single column and the `−/+` control is absent

### Requirement: The card states resolved model, option name and status

A Live card SHALL show, in its header, the model the worker's current run resolved to, and SHALL show
the worker option name on the ticket line below it. It SHALL show the worker's status as a word
carrying the state hue, and SHALL show no status glyph in the header.

#### Scenario: Resolved model in the header, option on the ticket line

- **WHEN** a worker is running on the `standard` option, which resolved to a Sonnet model
- **THEN** the header names the resolved Sonnet model and the ticket line carries `standard`

#### Scenario: No status glyph

- **WHEN** a card renders a running worker
- **THEN** the header shows the status word and no status glyph

### Requirement: Feeds hold real scrollback and keep authored layout

A Live card's feed SHALL show the run's real scrollback through the shared worker feed, SHALL preserve
the authored indentation of each trace line, and SHALL hang wrapped continuations past the marker
column. The feed SHALL keep the transcript renderer's edit diffs.

#### Scenario: Indentation is preserved

- **WHEN** a run's trace includes an indented sub-line
- **THEN** the feed renders it with its authored indentation

#### Scenario: Edit diffs render

- **WHEN** a run changed files
- **THEN** the feed shows the edit diffs the shared transcript renderer produces

### Requirement: A named worker is focused on open

When Live is opened with a worker named in its address, the screen SHALL scroll to that worker's card
and mark it as the focused one; when the named worker is not in the current scope the screen SHALL
apply that worker's workspace scope so its card is present.

#### Scenario: Opening a worker from the Map

- **WHEN** the human opens `/v2/live` naming a worker from another workspace
- **THEN** the scope switches to that worker's workspace and its card is scrolled to and marked
