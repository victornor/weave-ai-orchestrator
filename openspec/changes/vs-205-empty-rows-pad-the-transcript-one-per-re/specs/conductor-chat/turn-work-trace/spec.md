## MODIFIED Requirements

### Requirement: A finished conductor turn keeps a work trace in the chat

The conductor chat SHALL keep, for every conductor turn it can identify in the loaded history, a section carrying that turn's work — the assistant text, the tool calls with their results, the phase markers and the errors the turn produced — reachable from the conversation itself rather than only from the run's own page.

The section SHALL be collapsed by default and SHALL be expandable in place. Collapsed, it SHALL be one line that says what the turn did without expanding it: how many tool calls it made, how many files it touched, how long it took, and how many tokens it spent. When the turn's own model and its context window are both known, the line SHALL also show how much of that window the turn's last request used, as a size over the window (for example `82k/200k ctx`), matching the form the chat's own context meter already uses. Expanded, it SHALL render the turn with the same transcript presentation the live view and the run page use, so that a tool call reads the same way whether it is watched live or read back — one row per tool call, never a further row for a companion event a runtime adapter recorded for the same call and that carries nothing beyond what that row already shows.

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

#### Scenario: A tool call with a duplicate companion event

- **WHEN** an expanded turn's events include a tool call, its result, and a further event a runtime
  adapter recorded for the same call carrying no information beyond what that call's row already
  shows
- **THEN** the expanded trace still shows one row for that call, not a second, near-empty one
