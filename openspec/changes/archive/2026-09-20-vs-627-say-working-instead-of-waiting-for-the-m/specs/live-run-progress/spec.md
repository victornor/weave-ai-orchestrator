## MODIFIED Requirements

### Requirement: A live run never shows a bare working state
While a run is live, its page SHALL render a live activity row derived from the run's events and partial output: the current state, the turn's elapsed time, the number of tool calls so far, and the time since the last event. The state SHALL be one of: streaming text, thinking, waiting on the model (shown as `Working` with its elapsed seconds), running a named tool (with its target and elapsed seconds), or an explicit statement that the runtime reports whole steps only. The row SHALL update on a one-second clock without any network activity and SHALL NOT poll.

#### Scenario: Model is generating between steps
- **WHEN** the last event is a completed tool result and nothing has arrived for 4 s
- **THEN** the row reads "Working" with 4 s elapsed and a turn total

#### Scenario: A long turn that never narrates
- **WHEN** a run has made 50 tool calls over five minutes and emitted no assistant text
- **THEN** the row shows the running tool with its command or path, the count 50, the turn elapsed time and the time since the last event

#### Scenario: Runtime cannot stream
- **WHEN** the run's runtime declares no partial output
- **THEN** the row says so in words and still shows elapsed time, tool count and time since the last event