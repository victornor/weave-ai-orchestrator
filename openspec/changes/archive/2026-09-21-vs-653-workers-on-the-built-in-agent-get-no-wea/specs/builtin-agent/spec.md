## ADDED Requirements

### Requirement: The child reports the tools it offered
The child SHALL emit a `tools.offered` event listing every tool name it will offer the model, once per turn before the first request.

#### Scenario: A worker turn
- **WHEN** a worker turn starts with the run-scoped Weave server and an `outputSchema`
- **THEN** the run's events contain `tools.offered` whose names include the ticket, report and ask tools and `submit_result`

### Requirement: A turn never starts with tools its prompt names missing
When the run carries an `outputSchema` the child SHALL offer `submit_result`, and when the run-scoped Weave server lists no tools the child SHALL NOT start the turn. In either case the turn SHALL end with error code `tools_missing`, family `tooling`, naming what is missing.

#### Scenario: Weave server lists nothing
- **WHEN** the Weave MCP server initialises but lists zero tools
- **THEN** the turn ends with `tools_missing` and no model request is made

#### Scenario: Result schema present
- **WHEN** a run carries an `outputSchema`
- **THEN** the offered tools include `submit_result`

### Requirement: An empty worker turn is not a success
A worker turn that owed a report, returned none and left no evidence on its ticket, in a ticket status where the worker is expected to act, SHALL be recorded as failed with code `empty_turn`, family `tooling`.

#### Scenario: Empty turn
- **WHEN** a worker turn ends with no report and no ticket evidence while its ticket is `todo`
- **THEN** the run status is `failed` with code `empty_turn`

#### Scenario: Waiting worker
- **WHEN** the ticket is `in_review` and the turn ends without a report
- **THEN** the run is not failed as `empty_turn`

### Requirement: Empty turns stop the automatic resume
After two consecutive `empty_turn` or empty runs for a worker's ticket, the supervisor SHALL raise the existing gate finding and SHALL NOT enqueue further `liveness_repair` wakes for that agent until a human comment, an answered decision or weaver steering arrives.

#### Scenario: Bounded resume
- **WHEN** two consecutive runs of a worker ended empty
- **THEN** the next liveness scan enqueues no `liveness_repair` wake and one gate finding exists
