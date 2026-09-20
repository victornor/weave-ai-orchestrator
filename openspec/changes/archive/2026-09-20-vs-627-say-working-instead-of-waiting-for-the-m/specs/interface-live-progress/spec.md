## MODIFIED Requirements

### Requirement: Every interface consumes the one live model
An interface that displays or talks to a running agent SHALL derive its live state from the shared runtime-neutral model (`liveTurn` over the run's events and partial output), not from a surface-specific "working" string. While a turn is live, no such interface SHALL render a bare or empty working state: each SHALL show what the agent is doing and how long it has been doing it, updating on its own clock without polling.

#### Scenario: The conductor is generating
- **WHEN** the weaver chat is following a live turn whose last event was a completed tool result and nothing has arrived for 4 s
- **THEN** the live section reads "Working" with 4 s elapsed and the turn total

#### Scenario: A surface with no live row
- **WHEN** any audited surface is rendered during a live turn
- **THEN** it shows the state word and elapsed time from `liveTurn`, or states that the runtime reports whole steps only

### Requirement: The terminal UI shows the live row

`weave attach` and `weave chat` SHALL, while a turn is live, render the row the shared formatter produces for the run's events and partial output: the current state, the seconds in that state, the turn's elapsed time, the tool-call count and the time since the last event, updating on a one-second clock with no polling. They SHALL read `GET /runs/:id/live` on open and on reconnect and then follow the run's `run.delta` frames on the workspace stream. Neither SHALL render a bare "working" or "starting" state while a turn is live.

#### Scenario: A turn between steps

- **WHEN** `weave attach` is following a turn whose last event is a completed tool result and nothing has arrived for 4 s
- **THEN** the row above the status bar reads "Working" with 4 s elapsed and the tool count

#### Scenario: A frame moves the row without a run event

- **WHEN** the workspace stream delivers a `run.delta` frame carrying text for the run `weave attach` is following
- **THEN** the row reads "Writing" without a new run event and without a network request

#### Scenario: Reconnect recovers the partial in flight

- **WHEN** the workspace subscription drops and reconnects while a part is half generated
- **THEN** `weave attach` reads `GET /runs/:id/live` once and continues from the next `run.delta` frame

#### Scenario: The chat working block

- **WHEN** the weaver has a live turn
- **THEN** `weave chat`'s working block shows the same live row instead of the literal "weaver is working…"

#### Scenario: A runtime that cannot stream

- **WHEN** the run's runtime declares no partial output
- **THEN** the terminal row says so in words and still shows the elapsed time and tool count