## MODIFIED Requirements

### Requirement: A finished conductor turn keeps a work trace in the chat

The conductor chat SHALL keep, for every conductor turn it can identify in the loaded history, a section carrying that turn's work — the assistant text, the tool calls with their results, the phase markers and the errors the turn produced — reachable from the conversation itself rather than only from the run's own page.

The section SHALL be collapsed by default and SHALL be expandable in place. Collapsed, it SHALL be one line that says what the turn did without expanding it: how many tool calls it made, how many files it touched, and how long it took. Expanded, it SHALL render the turn with the same transcript presentation the live view and the run page use, so that a tool call reads the same way whether it is watched live or read back — one row per tool call, never a further row for a companion event a runtime adapter recorded for the same call and that carries nothing beyond what that row already shows.

A turn that produced a reply SHALL carry its section with that reply. A turn whose reply is not in the loaded history SHALL NOT duplicate the section elsewhere.

#### Scenario: Reading back a finished turn

- **WHEN** the human looks at a conductor reply whose turn has finished
- **THEN** a collapsed section under that reply reports the turn's tool calls, files touched and duration

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
