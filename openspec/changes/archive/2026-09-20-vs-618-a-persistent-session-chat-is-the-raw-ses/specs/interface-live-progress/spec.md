## MODIFIED Requirements

### Requirement: Role sessions show live progress

A persistent role session's thread feed SHALL render the live turn the way the other conversation surfaces do: the streaming text and reasoning still being generated, each tool call and its result as they arrive, and the live activity row — all for the session agent's active run, so a ticketless session is never indistinguishable from an idle one. The live turn SHALL render below the conversation's delivered messages, where the turn's answer will land. When the turn ends, its transcript SHALL remain in the conversation as that turn's record, unchanged, with its final text appearing once. A turn that produced no final text SHALL NOT be announced with a system notice; a turn that failed, timed out or was cancelled SHALL still leave its real reason. Streaming SHALL affect only the run view: partial output SHALL NOT create or edit a thread message. A session whose runtime declares no partial output SHALL still say so in words, as the live row does.

#### Scenario: A ticketless session works

- **WHEN** a role session's agent has a live run
- **THEN** its thread feed shows the streaming text, the tool calls as they arrive, and the live activity row for that run

#### Scenario: The answer replaces the live turn

- **WHEN** the turn's final answer is delivered into the session's thread
- **THEN** the streaming live turn section is replaced by the turn's finished transcript, with the answer's words shown exactly once and no gap of empty space

#### Scenario: A turn that ends without an answer

- **WHEN** the turn ends with no final text, having run tools
- **THEN** no system notice is shown, and the turn's finished transcript remains as the record of it

#### Scenario: A runtime that cannot stream

- **WHEN** the session's live run is on a runtime that declares no partial output
- **THEN** the thread feed says the runtime reports whole steps only, in words, and still shows the elapsed time, tool count and time since the last event

#### Scenario: The stream is not a message

- **WHEN** a session streams text before any final answer has been delivered
- **THEN** no thread message carries that text; it appears only in the live turn section
