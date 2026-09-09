# conductor-chat/turn-work-trace Specification

## Purpose
TBD - created by archiving change vs-74-conductor-chat-keeps-each-turn-s-work-tr. Update Purpose after archive.

## Requirements

### Requirement: A finished conductor turn keeps a work trace in the chat

The conductor chat SHALL keep, for every conductor turn it can identify in the loaded history, a section carrying that turn's work — the assistant text, the tool calls with their results, the phase markers and the errors the turn produced — reachable from the conversation itself rather than only from the run's own page.

The section SHALL be collapsed by default and SHALL be expandable in place. Collapsed, it SHALL be one line that says what the turn did without expanding it: how many tool calls it made, how many files it touched, and how long it took. Expanded, it SHALL render the turn with the same transcript presentation the live view and the run page use, so that a tool call reads the same way whether it is watched live or read back.

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

### Requirement: The trace is fetched only when it is expanded

The chat SHALL NOT load a turn's events in order to render the collapsed line, and the trace SHALL NOT be carried in the thread message. The collapsed line SHALL be served by a summary the daemon computes over the run, so that loading a page of history costs one summary request whatever the history contains, and paging further back does not multiply transcript requests.

A turn's events SHALL be requested the first time its section is expanded, and not before. Once loaded they SHALL be kept for the session, so collapsing and re-expanding the same turn does not fetch them again.

#### Scenario: History renders

- **WHEN** a page of chat history containing several finished turns is rendered with every section collapsed
- **THEN** no request for any of those turns' events is made

#### Scenario: First expansion

- **WHEN** the human expands a turn's section for the first time
- **THEN** that turn's events are requested and rendered

#### Scenario: Paging further back

- **WHEN** the human loads an earlier page of history
- **THEN** the added messages carry collapsed sections and no transcript is fetched for them

### Requirement: The daemon serves a run's trace summary as an aggregate

The daemon SHALL expose, for a set of runs in the workspace, a summary of each run's recorded work: the run's identity and status, when it started and finished, how long it took, how many tool calls it made, how many distinct files it changed, how many errors it recorded, and whether it recorded anything at all.

The summary SHALL be computed from the run's stored events rather than from anything the runtime has to report separately, so that a run recorded before this capability existed has a summary too. Requesting summaries for a set of runs SHALL be one request. A run id that names no run in the workspace SHALL be omitted from the answer rather than failing it.

#### Scenario: Summaries for a set of runs

- **WHEN** a client asks for the trace summaries of several runs at once
- **THEN** it receives one summary per known run, each carrying that run's counts and timing

#### Scenario: A run recorded before the capability existed

- **WHEN** the summary of a run recorded earlier is requested
- **THEN** it is computed from that run's stored events like any other

#### Scenario: Unknown run

- **WHEN** the set includes a run id belonging to no run in the workspace
- **THEN** that id is absent from the answer and the request still succeeds

### Requirement: Expansion is remembered for the session

Whether a turn's section is expanded SHALL be remembered per turn for the browsing session, so that reading back through a long history does not re-collapse what was already opened, and returning to the chat from another screen finds the same sections open.

The memory SHALL be scoped to the workspace and SHALL NOT outlive the session, and a section the human collapses SHALL stay collapsed on the same terms.

#### Scenario: Leaving and returning

- **WHEN** the human expands a turn's section, navigates to another screen and comes back to the chat
- **THEN** that section is still expanded

#### Scenario: Collapsing again

- **WHEN** the human collapses a section they had expanded
- **THEN** it is collapsed when they come back

### Requirement: A turn that said nothing still appears in the history

A conductor turn that finished without sending the human a message SHALL appear in the chat history as a compact row at the time it ran, so that work the conductor did on its own — a wake that only filed a ticket, or a turn that ended with nothing to say — is visible rather than absent. The row SHALL carry the same collapsed trace section as a reply does, collapsed by default.

These rows SHALL be ordered with the messages by time, and SHALL be visually secondary to the conversation. A turn still running SHALL NOT produce one; the live view already accounts for it.

#### Scenario: A wake that only filed a ticket

- **WHEN** a conductor turn finishes having filed a ticket and sent no message
- **THEN** a compact row for that turn appears in the history at the time it ran, with its trace collapsed

#### Scenario: Ordering

- **WHEN** such a turn ran between two messages in the loaded history
- **THEN** its row is rendered between them

#### Scenario: A turn in flight

- **WHEN** a conductor turn is still running
- **THEN** no trace-only row is rendered for it

### Requirement: Trace-only rows can be turned off for a device

The chat SHALL offer a preference that hides the rows for turns that produced no message, leaving the conversation as it reads today. The preference SHALL be per device rather than per workspace or per account, SHALL default to showing the rows, and SHALL take effect without reloading.

Hiding the rows SHALL NOT affect the trace section on a turn that did reply.

#### Scenario: Turning the rows off

- **WHEN** the human turns the preference off
- **THEN** rows for turns that produced no message are no longer rendered, and replies keep their trace sections

#### Scenario: Default

- **WHEN** the human has expressed no preference
- **THEN** the rows are shown

### Requirement: A turn that cannot be identified shows nothing extra

A message the chat cannot attribute to a run SHALL be rendered exactly as it is today, with no trace section, no placeholder and no failed request. This SHALL hold for messages written before turns were attributed to runs and for messages that reached the thread by another route.

#### Scenario: An unattributed message

- **WHEN** a message in the loaded history carries no run
- **THEN** it renders with no trace section and nothing is requested for it

### Requirement: A turn's trailing structured report renders as a collapsed detail

When an expanded turn's trace includes the agent's end-of-turn structured report — the fenced JSON
block every turn ends with, carrying its run state, summary, ticket updates, next action and
knowledge disposition — the trace SHALL render it as a collapsed, expandable detail in the same
visual register as a tool call, never as a plain paragraph of conversational text.

Collapsed, it SHALL show a one-line summary that does not require expansion to read: at minimum the
report's run state. Expanding it SHALL show the report's full content.

A block of assistant text that is not the turn's structured report SHALL continue to render as
ordinary transcript text, unaffected by this requirement.

#### Scenario: A turn ending with its structured report

- **WHEN** a human expands a turn's trace and that turn's final assistant output is its end-of-turn
  structured report
- **THEN** the report appears as a collapsed one-line detail rather than a raw JSON paragraph

#### Scenario: Expanding the report detail

- **WHEN** the human expands the collapsed report detail
- **THEN** the report's full content is shown

#### Scenario: Ordinary assistant text is unaffected

- **WHEN** a turn's trace includes assistant text that does not parse as the structured report
- **THEN** that text renders as it does today, with no collapsing applied
