# interface-live-progress Specification

## Purpose
Defines what every web interface that shows or talks to an agent must render while a turn is live — the weaver and planner chats, role sessions, the board, live, ticket and decision surfaces and the runs list — all over the one runtime-neutral live model VS-595 introduced. A surface a person watches must never read as a bare "working", and a human-facing delivery channel must never receive words an agent has not chosen to send. (The terminal UI and CLI follow output are VS-603; channel progress and Telegram are VS-604, both briefed by design.md §1.)

## Requirements

### Requirement: Every interface consumes the one live model
An interface that displays or talks to a running agent SHALL derive its live state from the shared runtime-neutral model (`liveTurn` over the run's events and partial output), not from a surface-specific "working" string. While a turn is live, no such interface SHALL render a bare or empty working state: each SHALL show what the agent is doing and how long it has been doing it, updating on its own clock without polling.

#### Scenario: The conductor is generating
- **WHEN** the weaver chat is following a live turn whose last event was a completed tool result and nothing has arrived for 4 s
- **THEN** the live section reads "waiting for the model" with 4 s elapsed and the turn total, not "working"

#### Scenario: A surface with no live row
- **WHEN** any audited surface is rendered during a live turn
- **THEN** it shows the state word and elapsed time from `liveTurn`, or states that the runtime reports whole steps only

### Requirement: Web conversations show the live row as run view
The weaver chat and every planner chat SHALL render the live activity row — the state, the seconds in that state, the tool-call count and the time since the last event — for the turn each is following. Once the runtime supplies partial output, the chat SHALL render the streaming text and reasoning as part of the run view. Streamed text SHALL NOT be delivered as a message: `weave_human_send` remains the only path by which the weaver's words reach the human, and a planner's streamed text stays a run view until it is sent.

#### Scenario: Weaver turn streams
- **WHEN** a Claude weaver turn streams text and tools
- **THEN** the chat shows the live row moving through writing, running a tool and waiting, and the streaming text as run view

#### Scenario: Nothing is delivered early
- **WHEN** the weaver has streamed text but not called `weave_human_send`
- **THEN** no message bubble and no outbound thread message carries that text

### Requirement: Role sessions show live progress
A persistent role session's thread feed SHALL show the live activity row for the session agent's active run, so a ticketless session is never indistinguishable from an idle one.

#### Scenario: A ticketless session works
- **WHEN** a role session's agent has a live run
- **THEN** its thread feed shows the live activity row for that run

### Requirement: Board, live, ticket, runs and decision surfaces show live progress
The board cards, the ticket header, the Live page, the runs list and decision cards SHALL show the live state and elapsed time of a running agent, and SHALL never show a bare "Working". The board and ticket header MAY keep their single coalesced `worker.activity` frame instead of a per-card stream, provided that frame carries the same states and the elapsed time.

#### Scenario: Board card mid-turn
- **WHEN** a worker on a board card is mid-turn
- **THEN** the card shows the live state and elapsed time, never a bare "Working"

#### Scenario: Decision under review
- **WHEN** a decision revision is being produced by a live run
- **THEN** the decision view shows the live state and elapsed time, not just "Ns ago"

### Requirement: Whole-steps-only is said in words
Where the run's runtime declares no partial output, every web surface SHALL say so in words, exactly as the live row does, and SHALL still show the elapsed time, tool count and time since the last event.

#### Scenario: A runtime that cannot stream
- **WHEN** a codex run is live before its partial-output follow-up lands
- **THEN** the web surfaces say the runtime reports whole steps only, with the elapsed time and tool count

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
