## ADDED Requirements

### Requirement: A running turn accepts live input and delivers it at a request boundary

The child SHALL keep reading its stdin after `init`, and a `send` line SHALL queue its text for the running turn. Queued text SHALL be appended to the session as user messages at a request boundary, after the previous step's tool results, so the model sees it in the next request. When a step produces no tool calls and the queue is non-empty, the turn SHALL continue instead of ending. The adapter's `TurnHandle.send` SHALL write the `send` line and resolve `delivered` while the child runs, and SHALL resolve `closed` without writing once the child's `result` line has been seen or its stdin has closed. Live input SHALL never break the history: every queued message is a plain user message and every persisted history remains valid.

#### Scenario: Delivered after the tool results

- **WHEN** a `send` arrives while a tool call runs and the model is asked again
- **THEN** the next request body contains the sent text after the tool result, and the turn's answer addresses it

#### Scenario: No tool call pending

- **WHEN** a step ends with no tool calls and the queue holds text
- **THEN** the text is appended and the turn asks the model again instead of ending

#### Scenario: Closed after the result

- **WHEN** `send` is called after the child's `result` line has been seen
- **THEN** it resolves `closed` and nothing is written to the child

#### Scenario: A human steers the weaver mid-turn

- **WHEN** a weaver-kind turn is running and a human message is delivered to it mid-turn
- **THEN** the turn answers that message in the same turn and the session history is valid

### Requirement: The final report can be produced as structured output

When `init` carries an `outputSchema`, the child SHALL add a `submit_result` tool whose parameter schema is that schema, SHALL instruct the model to call it last, and SHALL offer it in every permission mode regardless of a role's tool allow list. A call whose arguments satisfy the schema SHALL populate the result's `structured` field and end the turn, with an ordinary tool result persisted so the tool call stays paired. A call whose arguments do not satisfy the schema SHALL return a corrective tool result naming each violation, and SHALL be corrected at most twice; a third invalid call SHALL fail the turn with `tool_call_invalid` in family `tooling`. When the model ends the turn with text and no `submit_result`, the child SHALL ask it once more, at most twice. The run engine SHALL carry the schema only for a turn that owes a report — a worker, the weaver, a planner, or a session that holds a ticket — and never for a ticketless persistent session.

#### Scenario: Valid report

- **WHEN** the model calls `submit_result` with arguments satisfying the run's schema
- **THEN** the turn result's `structured` is those arguments and the turn ends

#### Scenario: Invalid arguments corrected twice then failed

- **WHEN** the model calls `submit_result` three times with arguments that violate the schema
- **THEN** the first two results name the violations and the third fails the turn `tool_call_invalid`

#### Scenario: Nudged once when the model stops without submitting

- **WHEN** the model answers with text, calls no tool, and the schema has not been satisfied
- **THEN** the child asks it to call `submit_result` again rather than ending the turn

#### Scenario: Offered in restricted mode

- **WHEN** a turn with an `outputSchema` runs in `restricted` mode
- **THEN** the recorded request body's tool list includes `submit_result`

#### Scenario: A ticketless session is not forced to report

- **WHEN** a ticketless persistent session runs a turn
- **THEN** its turn carries no output schema, the request offers no `submit_result` tool, and the turn is never nudged for a report

### Requirement: A todo tool replaces the run's list

The child SHALL offer a `todo_write` tool that takes a list of items, each with `content` and a `status` of `pending`, `in_progress` or `completed`. A call SHALL replace the run's whole todo list and SHALL return a summary of the new list. `todo_write` SHALL change no file and run no command, SHALL be available in every permission mode including `restricted`, and SHALL emit a `plan.proposed` run event carrying the items, matching the event the codex runtime emits for its todo list.

#### Scenario: Replaces the list

- **WHEN** `todo_write` is called with a new list after an earlier call
- **THEN** the run's list is the new one and the result summarises it

#### Scenario: Available in restricted mode

- **WHEN** a turn runs in `restricted` mode
- **THEN** the recorded request body's tool list includes `todo_write`

#### Scenario: Plan event

- **WHEN** `todo_write` is called
- **THEN** a `plan.proposed` event is emitted carrying the supplied items

## MODIFIED Requirements

### Requirement: The three permission modes decide the tool set up front

`restricted` SHALL expose only `read`, `grep`, `glob`, `todo_write`, `skill`, the run-scoped Weave server's tools, and the tools of a user MCP server whose definition sets `readOnly: true` and that the role's allow list names; it SHALL remove the write-capable tools (`write`, `edit`, `bash`) and every other user MCP server's tools from the request body itself so the model is never offered them. `auto` SHALL expose all seven core tools (`read`, `write`, `edit`, `bash`, `grep`, `glob`, `todo_write`) plus every allowed MCP server's tools, enforce the confinement rules and the bash deny patterns, and never ask for approval. `bypass` SHALL expose all tools, skip the bash deny patterns and skip root confinement for reads, while the protected-path list still applies to the file tools. A synthetic internal tool the loop adds itself (`submit_result`) SHALL be offered in every mode. A call the mode does not allow SHALL return `Denied by permission mode "<mode>"` and SHALL emit a `tool.denied` event rather than an unknown-tool error.

#### Scenario: Restricted request body

- **WHEN** a turn runs in `restricted` with the run-scoped Weave server and a user MCP server available
- **THEN** the recorded request body's tool list contains only `read`, `grep`, `glob`, `todo_write`, `skill` and the run-scoped Weave tools, and no user `mcp__…` tool

#### Scenario: A read-only user server survives restricted

- **WHEN** a turn runs in `restricted`, the role allows a server marked `readOnly: true`, and the server lists its tools
- **THEN** that server's `mcp__…` tools are in the request body's tool list

#### Scenario: Forced call in restricted

- **WHEN** the model calls `write` in a `restricted` turn
- **THEN** the result is `Denied by permission mode "restricted"` and a `tool.denied` event is emitted

### Requirement: Adapter surface for this slice

The `weave` adapter SHALL declare `resumableSessions: true`, `streamingInput: true`, `structuredOutput: true`, `mcp: true`, `usageReporting: 'per_turn'`, `costReporting: false` and `partialOutput: 'full'`. `TurnHandle.send` SHALL be present and SHALL resolve `delivered` while the turn runs and `closed` once the child's result has been seen. The adapter SHALL forward the child's `structured` result. Model ids SHALL be `providerId/modelId` from workspace `providers` config. `detect()` SHALL be `available` only when the child entry exists and a provider is configured.

#### Scenario: No provider configured

- **WHEN** the workspace has no `providers` entry
- **THEN** `detect()` reports `unsupported` with a note

#### Scenario: Send while running and after the result

- **WHEN** a turn is running and `send` is called, then called again after the turn's result
- **THEN** the first call resolves `delivered` and the second resolves `closed`