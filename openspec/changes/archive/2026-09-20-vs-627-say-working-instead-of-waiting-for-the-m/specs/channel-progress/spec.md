## MODIFIED Requirements

### Requirement: Progress text is generic state only

The text the daemon sends to an external channel SHALL be built from the live state's state word, the seconds
in that state, the tool-call count and the whole-steps-only notice. It SHALL NOT contain a tool name, a
command, a file path, a tool argument or any streamed model text, because an external channel publishes and
may cache what it receives. Streamed text and tool details SHALL stay in the in-product run view. The
`waiting` state's word SHALL be `Working`, the same generic word a running tool already uses, so an external
channel never names the model.

#### Scenario: A running tool is stated generically

- **WHEN** a run has an open `bash` tool call and the daemon sends a progress update
- **THEN** the text reads `Working · <n> s · <m> tool calls` and contains no part of the command or its target

#### Scenario: Waiting on the model is stated generically

- **WHEN** the last event was a completed tool and the model is generating the next step
- **THEN** the text reads `Working · <n> s` with no model text