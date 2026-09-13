## Purpose

Defines how an edit-type tool call — one that changes or writes a file — renders in any transcript
of run events, so a human watching or reading back a run sees the actual change rather than a bare
file path, consistently across every surface that renders a transcript.

## ADDED Requirements

### Requirement: An edit tool call renders as a diff

A transcript SHALL render a Claude `Edit` or `MultiEdit` tool call, and an opencode `edit` tool
call, as a diff of the change it made: the file path, old and new line numbers, added lines tinted
and marked distinctly from removed lines, and syntax highlighting chosen from the file's extension.
A `MultiEdit` call that carries more than one edit SHALL render each edit as its own diff, in the
order the call listed them.

The diff SHALL use the same hunk rendering the pull request diff view uses, so a diff reads the same
way whether it came from a tool call or from a pull request.

#### Scenario: A Claude Edit call

- **WHEN** a transcript includes a Claude `Edit` tool call recording `old_string` and `new_string`
  for a file
- **THEN** that call renders as a diff of the file with old and new line numbers, add/remove tinting
  and syntax highlighting, not a bare file path

#### Scenario: An opencode edit call

- **WHEN** a transcript includes an opencode `edit` tool call recording `oldString` and `newString`
  for a file
- **THEN** that call renders the same way a Claude `Edit` call does

#### Scenario: A MultiEdit call with several edits

- **WHEN** a transcript includes a Claude `MultiEdit` call whose `edits` field lists three edits to
  the same file
- **THEN** the transcript shows three diffs, in the order the call listed them

### Requirement: A diff falls back to unified when its cell is narrow

An edit tool call's diff SHALL render side by side when the space rendering it is wide enough to
read two columns, and unified when it is not. This SHALL hold independent of the surface: a wide
Live cell and a narrow one make this choice independently, the same way a desktop and a phone
viewport already do for the pull request diff view.

#### Scenario: A wide cell renders side by side

- **WHEN** an edit tool call's diff renders in a space wide enough for two readable columns
- **THEN** the diff renders side by side, old on the left and new on the right

#### Scenario: A narrow cell renders unified

- **WHEN** an edit tool call's diff renders in a space too narrow for two readable columns
- **THEN** the diff renders as a single unified column instead

### Requirement: A written file renders as its content

A transcript SHALL render a Claude `Write` tool call, and an opencode `write` tool call, as the
content it wrote: numbered lines with syntax highlighting chosen from the file's extension, not a
bare file path or a confirmation message.

A written file long enough that showing it in full would dominate the transcript SHALL render
collapsed behind an expand control, the same pattern already used for long command output, rather
than being cut short or hidden entirely.

#### Scenario: A Claude Write call

- **WHEN** a transcript includes a Claude `Write` tool call recording the file's `content`
- **THEN** that call renders the file's numbered, highlighted content

#### Scenario: An opencode write call

- **WHEN** a transcript includes an opencode `write` tool call recording the file's `content`
- **THEN** that call renders the same way a Claude `Write` call does

#### Scenario: A long written file collapses

- **WHEN** a written file's content is long enough to dominate the transcript
- **THEN** it renders collapsed behind an expand control, and expanding it shows the full content

### Requirement: An unrecognised or incomplete edit payload falls back to the compact row

A tool call this capability does not recognise as an edit or write, or one whose payload is missing
the fields a diff or written-file rendering needs, SHALL render as the transcript's existing compact
tool row — name, target, duration, add/remove counts when known — never as an empty or broken card.

Tool output and file content are untrusted text: rendering them SHALL NOT interpret any of it as
HTML, and syntax highlighting SHALL escape the source text the same way the pull request diff view's
highlighting already does.

#### Scenario: An unknown tool

- **WHEN** a transcript includes a tool call whose name this capability does not recognise as an
  edit or write
- **THEN** it renders as the compact tool row, unaffected by this capability

#### Scenario: An edit call missing its payload

- **WHEN** a transcript includes a recognised edit-type tool call whose payload is missing the
  fields a diff needs
- **THEN** it renders as the compact tool row rather than an empty or broken diff

#### Scenario: File content containing markup is not interpreted as HTML

- **WHEN** a written file's content or an edit's old or new text contains characters that would be
  HTML markup
- **THEN** the rendered content shows that text literally, and no markup it contains is executed or
  rendered as part of the page
