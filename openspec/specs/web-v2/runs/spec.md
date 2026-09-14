# web-v2/runs Specification

## Purpose
The global V2 Runs screen and its run detail: every workspace's turns in one dense, filterable table
merged by recency, and a per-run view of what the turn did and how it ended.

## Requirements

### Requirement: Runs lists every workspace's turns, merged by recency

The V2 screen at `/v2/runs` SHALL list the turns of every workspace together, newest first, fanned out
across the per-workspace runs API and merged client-side. It SHALL offer a load-more control that
appends older turns without discarding what is already shown, and SHALL show an empty state when no
workspace has any turn.

#### Scenario: Turns from multiple workspaces

- **WHEN** two workspaces each have turns
- **THEN** `/v2/runs` shows both workspaces' turns in one list, newest first

#### Scenario: Load more

- **WHEN** the human activates load-more
- **THEN** older turns are appended in recency order and the already-shown turns remain

### Requirement: The state chips filter for real

The screen SHALL offer a state filter of `all · queued · running · succeeded · failed · timed_out ·
cancelled · interrupted`, and choosing one SHALL show only turns in that state. Any figure the screen
shows SHALL derive from the same merged list the table renders, so a count cannot contradict the
rows.

#### Scenario: Filter by state

- **WHEN** the human chooses `failed`
- **THEN** only failed turns are listed

#### Scenario: Filtering changes a figure and the rows together

- **WHEN** a state filter is applied
- **THEN** any figure the screen shows and the rows change from the same source

### Requirement: The table is dense and collapses on phone

On desktop the screen SHALL render a table with the columns status (with glyph), agent, model, turn
ended, tokens, cost, duration and when, with the agent and model columns taking the remaining width as
numeric columns shrink. On phone each turn SHALL render as a card carrying its state, agent, model,
tokens and cost.

#### Scenario: Desktop columns

- **WHEN** the list renders at desktop width
- **THEN** each turn shows its status with glyph, agent, model, turn-ended outcome, tokens, cost,
  duration and when

#### Scenario: Phone cards

- **WHEN** the list renders at phone width
- **THEN** each turn is a card, not table columns

### Requirement: A row opens the run detail

Selecting a turn SHALL open its run detail at `/v2/runs/$runId`, and the Runs rail row SHALL stay the
highlighted destination while a run detail is open.

#### Scenario: Opening a run

- **WHEN** the human selects a turn
- **THEN** the run detail for that run opens with Runs still highlighted

### Requirement: Run detail shows state, metadata, trace and ending

The run detail SHALL show the run's state and its turn outcome, a metadata table naming the agent, the
model, the start time, the duration, the tokens (with the model's context), the cost and the trigger,
the full tool trace, and a plain-language account of how the turn ended. The trigger SHALL be derived
from the wake records the run carries, and the screen SHALL NOT present a trigger it cannot derive.

#### Scenario: A completed run

- **WHEN** a run that asked a decision and then finished is opened
- **THEN** its state, metadata, tool trace and its own account of how it ended are shown

#### Scenario: A retried turn

- **WHEN** a run exists because a previous run was retried
- **THEN** its trigger names the retry rather than a generic label

#### Scenario: No derivable trigger

- **WHEN** a run carries no wake record the client can resolve
- **THEN** the trigger states that plainly instead of inventing a reason

### Requirement: The global run detail resolves the run's own workspace

`/v2/runs/$runId` SHALL render the detail for a run in any loaded workspace, including one other
than the first workspace loaded, without a `WorkspaceProvider` on the route and without assuming any
particular workspace. Opening the URL directly SHALL resolve the same run as opening it from the Runs
list.

#### Scenario: A run in a non-first workspace

- **WHEN** `/v2/runs/$runId` is opened for a run whose workspace is not the first loaded
- **THEN** the run detail renders its state, metadata, tool trace and ending, with no error boundary

#### Scenario: Opened directly by URL

- **WHEN** a run detail URL is opened without first navigating through the Runs list
- **THEN** the run's own workspace is resolved from the run itself, not from the route context

#### Scenario: An unknown run

- **WHEN** the run id matches no loaded workspace
- **THEN** the screen shows the run-not-found state, not an error boundary
