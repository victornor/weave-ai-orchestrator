## ADDED Requirements

### Requirement: The terminal UI shows the live row

`weave attach` and `weave chat` SHALL, while a turn is live, render the row the shared formatter produces for the run's events and partial output: the current state, the seconds in that state, the turn's elapsed time, the tool-call count and the time since the last event, updating on a one-second clock with no polling. They SHALL read `GET /runs/:id/live` on open and on reconnect and then follow the run's `run.delta` frames on the workspace stream. Neither SHALL render a bare "working" or "starting" state while a turn is live.

#### Scenario: A turn between steps

- **WHEN** `weave attach` is following a turn whose last event is a completed tool result and nothing has arrived for 4 s
- **THEN** the row above the status bar reads "Waiting for the model" with 4 s elapsed and the tool count, not "working"

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

### Requirement: The CLI follow output shows the live row

`weave runs tail` SHALL print the live line for the run it follows as `run.delta` frames arrive, beside the transcript, and SHALL print the completed step when the corresponding completed event lands. It SHALL read `GET /runs/:id/live` on open and on reconnect before continuing from frames.

#### Scenario: A tool is running

- **WHEN** a `run.delta` frame for the followed run arrives while a tool is running
- **THEN** `weave runs tail` prints the live line (for example "Running bash sleep 3 · 3 s") and still prints the transcript block when the tool completes

#### Scenario: A part completes

- **WHEN** the completed event supersedes a streaming part
- **THEN** the live line for that part stops and the completed step is printed exactly once

#### Scenario: The runtime reports whole steps only

- **WHEN** the followed run's runtime declares no partial output
- **THEN** the printed live line says "whole steps only" and still carries the state, elapsed time and tool count

### Requirement: The fleet view names what each worker is doing

`weave top` SHALL render each running worker's live activity label and elapsed time from the `worker.activity` fields, refreshed by the `worker.activity` frames it already receives, so a worker mid-turn never reads as only a status word on the fleet screen.

#### Scenario: A worker mid-turn

- **WHEN** a worker on `weave top` is mid-turn
- **THEN** its row shows the live label and the elapsed time, not only its status label

#### Scenario: A worker with no run in progress

- **WHEN** a worker on `weave top` has no run in progress
- **THEN** its row falls back to its status label

### Requirement: Terminal and CLI surfaces do not fork the wording

The terminal UI and the CLI follow output SHALL derive their live line from the same runtime-neutral model and formatter the web row uses, so a state cannot be spelled two ways. No terminal or CLI surface SHALL introduce its own wording for a live state.

#### Scenario: Same words everywhere

- **WHEN** any terminal or CLI surface renders a live state
- **THEN** the words are those the shared formatter produces for that state
