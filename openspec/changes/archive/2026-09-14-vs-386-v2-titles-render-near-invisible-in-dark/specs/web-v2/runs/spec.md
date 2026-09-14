## ADDED Requirements

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
