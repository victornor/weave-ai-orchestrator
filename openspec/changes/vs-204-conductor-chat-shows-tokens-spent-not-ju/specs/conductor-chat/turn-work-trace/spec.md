## MODIFIED Requirements

### Requirement: A finished conductor turn keeps a work trace in the chat

The conductor chat SHALL keep, for every conductor turn it can identify in the loaded history, a section carrying that turn's work — the assistant text, the tool calls with their results, the phase markers and the errors the turn produced — reachable from the conversation itself rather than only from the run's own page.

The section SHALL be collapsed by default and SHALL be expandable in place. Collapsed, it SHALL be one line that says what the turn did without expanding it: how many tool calls it made, how many files it touched, how long it took, and how many tokens it spent. When the turn's own model and its context window are both known, the line SHALL also show how much of that window the turn's last request used, as a size over the window (for example `82k/200k ctx`), matching the form the chat's own context meter already uses. Expanded, it SHALL render the turn with the same transcript presentation the live view and the run page use, so that a tool call reads the same way whether it is watched live or read back.

A turn produced by a runtime that reported no usage for it SHALL show the line exactly as it would without this requirement — no token count, no context fraction, no zero, no placeholder, and no dangling separator where the figure would have gone.

A turn produced by a runtime that reported token usage but no context-window figure for the last request, or whose model's context window is not known, SHALL show its tokens spent and omit the context fraction, on the same terms.

A turn that produced a reply SHALL carry its section with that reply. A turn whose reply is not in the loaded history SHALL NOT duplicate the section elsewhere.

#### Scenario: Reading back a finished turn

- **WHEN** the human looks at a conductor reply whose turn has finished
- **THEN** a collapsed section under that reply reports the turn's tool calls, files touched and duration

#### Scenario: The line reports tokens spent

- **WHEN** a finished turn's run recorded token usage
- **THEN** the collapsed section's line includes the turn's total tokens spent, in the same compact form (`18.4k tok`) tokens are shown elsewhere in the app

#### Scenario: The line reports context-window usage when it is known

- **WHEN** a finished turn's run recorded a context size for its last request, and the model it ran on has a known context window
- **THEN** the collapsed section's line includes that size over the window, and does not show it as a bare percentage of a window that could be wrong

#### Scenario: No usage reported for the turn

- **WHEN** a finished turn's run recorded no token usage at all, because its runtime does not report usage
- **THEN** the collapsed section's line reports tool calls, files, errors and duration exactly as it would otherwise, with no token count, no `0 tok`, and no separator left dangling in its place

#### Scenario: Tokens known, context window not

- **WHEN** a finished turn's run recorded token usage but no context size for its last request, or the model it ran on has no known context window
- **THEN** the collapsed section's line includes the turn's tokens spent and omits the context fraction entirely

#### Scenario: Expanding the section

- **WHEN** the human expands the section on a finished turn
- **THEN** the turn's assistant text, tool calls with their results, phase markers and errors are rendered, in the order they happened

#### Scenario: A turn with nothing to show

- **WHEN** a finished turn recorded no tool calls, no files and no assistant text
- **THEN** the chat renders no trace section for it rather than an empty one

#### Scenario: Several replies from one turn

- **WHEN** one conductor turn sent more than one message to the same thread
- **THEN** the trace section appears once, on the last of those messages

### Requirement: The daemon serves a run's trace summary as an aggregate

The daemon SHALL expose, for a set of runs in the workspace, a summary of each run's recorded work: the run's identity and status, when it started and finished, how long it took, how many tool calls it made, how many distinct files it changed, how many errors it recorded, whether it recorded anything at all, the model it ran on, and its recorded token usage.

The summary SHALL be computed from the run's own stored record, so that a run recorded before this capability existed has a summary too; a run whose model or usage was never recorded SHALL be summarized with that field absent rather than the request failing. Requesting summaries for a set of runs SHALL be one request. A run id that names no run in the workspace SHALL be omitted from the answer rather than failing it.

#### Scenario: Summaries for a set of runs

- **WHEN** a client asks for the trace summaries of several runs at once
- **THEN** it receives one summary per known run, each carrying that run's counts, timing, model and usage

#### Scenario: A run recorded before the capability existed

- **WHEN** the summary of a run recorded earlier is requested
- **THEN** it is computed from that run's stored record like any other

#### Scenario: A run with no recorded usage

- **WHEN** the summary of a run whose runtime reported no usage is requested
- **THEN** the summary carries no usage for that run rather than a zero or an invented figure

#### Scenario: Unknown run

- **WHEN** the set includes a run id belonging to no run in the workspace
- **THEN** that id is absent from the answer and the request still succeeds

## ADDED Requirements

### Requirement: A message shows the tokens its turn spent, next to its timestamp

Each conductor message the chat can attribute to a run SHALL show, next to that message's timestamp, the total tokens the run's turn spent, in the same compact form used elsewhere. The figure SHALL read as secondary reference information, not as the headline of the message.

A message whose turn recorded no usage, or that cannot be attributed to a run, SHALL show its timestamp exactly as it would without this requirement — no token count, no zero, and no dangling separator.

A human message SHALL never show a token count, since no turn produced it.

#### Scenario: A conductor message with known usage

- **WHEN** the human reads a conductor message whose turn recorded token usage
- **THEN** the message's timestamp is followed by that turn's total tokens spent, in the compact form used elsewhere

#### Scenario: A conductor message with no usage recorded

- **WHEN** the human reads a conductor message whose turn recorded no usage, or that cannot be attributed to a run
- **THEN** the message's timestamp shows with no token count and no dangling separator

#### Scenario: A human message

- **WHEN** the human reads back a message they sent themselves
- **THEN** its timestamp carries no token count
