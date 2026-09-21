## ADDED Requirements

### Requirement: Tool calls written as message text fail the turn as tooling
When tools were offered and a model reply ends the turn with no structured tool calls but its text contains a known text-form tool-call marker (DeepSeek DSML), the child SHALL fail the turn with code `text_tool_calls` and family `tooling`, with a message that says the model wrote tool calls as text. The child SHALL NOT execute anything parsed from message text.

#### Scenario: DSML text with no structured calls
- **WHEN** a mock provider replies with DSML `invoke` text and finish reason `stop`
- **THEN** the turn result is an error `text_tool_calls`/`tooling` and no tool ran

#### Scenario: Ordinary prose is untouched
- **WHEN** a reply mentions tool calls in prose without a known marker, or carries structured calls alongside DSML text
- **THEN** the turn ends or continues exactly as before

### Requirement: A profile that declares tools unsupported fails a tool turn at start
When the resolved provider compat has `tools.supported: false` and the turn's tool list is non-empty, the child SHALL fail with code `tools_unsupported` and family `tooling` before sending any request.

#### Scenario: Unsupported tools
- **WHEN** a turn starts against a provider whose compat sets `tools.supported: false`
- **THEN** the turn fails `tools_unsupported`/`tooling` and the mock provider receives no request
