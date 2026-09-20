## MODIFIED Requirements

### Requirement: Web conversations show the live row as run view

The weaver chat and every planner chat SHALL render the live activity row — the state, the seconds in that state, the tool-call count and the time since the last event — for the turn each is following. A planner chat SHALL render the streaming text and reasoning as part of the run view once the runtime supplies partial output. The weaver chat SHALL render its streamed text and mid-turn tool trace only when the human has turned them on with a switch that is off by default and remembered in the browser across reloads: with it off the weaver chat SHALL show only the messages the weaver has sent plus the activity row, and with it on the streamed output SHALL be visibly marked as in-progress run output rather than a delivered message. Streamed text SHALL NOT be delivered as a message: `weave_human_send` remains the only path by which the weaver's words reach the human, and a planner's streamed text stays a run view until it is sent. When a turn's message is delivered, the run view SHALL be replaced by it with nothing duplicated.

#### Scenario: The weaver chat with the switch off

- **WHEN** the weaver is mid-turn and the switch is off
- **THEN** the chat shows the messages the weaver has sent and the live activity row, and no streamed text and no mid-turn tool trace

#### Scenario: Weaver turn streams

- **WHEN** the switch is on and a Claude weaver turn streams text and calls tools
- **THEN** the chat shows the streaming text and the tool rows inside a container marked as in-progress run output, beside the live activity row moving through writing, running a tool and waiting

#### Scenario: The choice is remembered

- **WHEN** the human turns the switch on and reloads the page
- **THEN** the weaver chat still shows the streamed output

#### Scenario: The delivered message replaces the stream

- **WHEN** the weaver's message is delivered while its run view is showing
- **THEN** the run view is replaced by that message and its words appear exactly once

#### Scenario: A planner chat streams

- **WHEN** a planner turn streams text and calls tools
- **THEN** the planner chat shows the streaming text, the tool rows and the live activity row

#### Scenario: Nothing is delivered early

- **WHEN** the weaver has streamed text but not called `weave_human_send`
- **THEN** no message bubble and no outbound thread message carries that text

### Requirement: Role sessions show live progress

A persistent role session's thread feed SHALL render the live turn the way the other conversation surfaces do: the streaming text and reasoning still being generated, each tool call and its result as they arrive, and the live activity row — all for the session agent's active run, so a ticketless session is never indistinguishable from an idle one. The live turn SHALL render below the conversation's delivered messages, where the turn's answer will land. When the turn's final message is delivered into the thread, the live turn section SHALL be replaced by that message with no duplicated text and no frame of empty space. When the turn ends without an answer, the thread's system notice SHALL replace the live turn section the same way. Streaming SHALL affect only the run view: partial output SHALL NOT create or edit a thread message. A session whose runtime declares no partial output SHALL still say so in words, as the live row does.

#### Scenario: A ticketless session works

- **WHEN** a role session's agent has a live run
- **THEN** its thread feed shows the streaming text, the tool calls as they arrive, and the live activity row for that run

#### Scenario: The answer replaces the live turn

- **WHEN** the turn's final answer is delivered into the session's thread
- **THEN** the live turn section is gone and the answer appears exactly once, with no duplicated text and no gap of empty space

#### Scenario: A turn that ends without an answer

- **WHEN** the turn ends without an answer and its system notice lands in the thread
- **THEN** the live turn section is replaced by that notice, the same way a delivered answer replaces it

#### Scenario: A runtime that cannot stream

- **WHEN** the session's live run is on a runtime that declares no partial output
- **THEN** the thread feed says the runtime reports whole steps only, in words, and still shows the elapsed time, tool count and time since the last event

#### Scenario: The stream is not a message

- **WHEN** a session streams text before any final answer has been delivered
- **THEN** no thread message carries that text; it appears only in the live turn section