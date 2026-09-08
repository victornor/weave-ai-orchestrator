# project-overview/pull-request-diff Specification

## Purpose
Describes what opening a pull request's diff shows in the project overview: the per-file tree, the
unified and side-by-side layouts, per-file loading, syntax highlighting, collapsed-region expansion,
how a binary or very large file is handled, where the diff content comes from and how it stays
current, and that none of it is anything but reading.

## Requirements

### Requirement: Opening a pull request shows its diff, file by file

Opening a pull request in the explorer SHALL show its diff, organised by file. Each file SHALL show
its path, its status — added, modified, deleted or renamed — and the number of lines it adds and
removes.

On a phone width the diff SHALL render unified. On a desktop width it SHALL render unified or
side-by-side, whichever layout was last chosen on that device, defaulting to unified.

A changed line SHALL be distinguished as added, removed or unchanged, and SHALL show its line number
on each side that has one — an added line has no line on the base side, a removed line has none on the
head side.

#### Scenario: A file's header

- **WHEN** a diff is opened
- **THEN** each file shows its path, its status, and its added and removed line counts

#### Scenario: Phone is always unified

- **WHEN** a diff is opened at a phone width
- **THEN** it renders unified, whatever layout was last chosen

#### Scenario: Desktop remembers the chosen layout

- **WHEN** a diff is opened at a desktop width after side-by-side was last chosen on that device
- **THEN** it renders side-by-side

#### Scenario: Line numbers on both sides

- **WHEN** a hunk is shown
- **THEN** every line shows the line number it has on the base side, the line number it has on the
  head side, or both, according to whether it was removed, added or unchanged

### Requirement: A file tree lets the reader jump to a file, and each file loads on its own

The explorer SHALL show a file tree or file list for the pull request's changed files, letting the
reader jump directly to any of them. Each file SHALL be collapsible independently of the others.

A file's diff content SHALL be requested only once that file is opened, not as part of opening the
pull request. Collapsing a file and opening it again SHALL NOT necessarily request its content again.

#### Scenario: Jumping to a file

- **WHEN** the reader selects a file from the tree
- **THEN** the explorer scrolls to or opens that file's diff

#### Scenario: Collapsing a file

- **WHEN** the reader collapses an open file
- **THEN** its diff is no longer shown, and the other open files are unaffected

#### Scenario: Content loads on demand

- **WHEN** a pull request with several changed files is opened
- **THEN** no file's diff content is requested until that file is opened

### Requirement: Syntax highlighting for the languages this workspace uses

A file's diff SHALL be syntax-highlighted for at least: TypeScript, TSX, JavaScript, JSX, JSON, YAML,
Markdown, CSS, SQL, shell, HTML, C#, Rust, Java, PHP, C++, C, Go, Python, Ruby, Kotlin, Swift and XML.
A file whose language is not recognised SHALL render unhighlighted rather than fail to render.

#### Scenario: A recognised language

- **WHEN** a changed file's language is one of the named minimum
- **THEN** its diff is syntax-highlighted

#### Scenario: An unrecognised language

- **WHEN** a changed file's language is not recognised
- **THEN** its diff still renders, without highlighting

### Requirement: Unchanged regions are collapsed and can be expanded

A gap between two hunks — lines the diff did not include because they are unchanged — SHALL be shown
collapsed, with a control that expands it to show that content.

An expand request for a region a file has no content for — before the start or after the end of an
added file, for instance — SHALL show nothing rather than fail.

#### Scenario: A gap between hunks

- **WHEN** a file's diff has more than one hunk
- **THEN** the lines between them are shown collapsed, with a control to expand them

#### Scenario: Expanding a region

- **WHEN** the reader activates the control on a collapsed region
- **THEN** that region's content is shown in place of the control

#### Scenario: Nothing to expand

- **WHEN** the reader expands a region of a file that has no content there
- **THEN** the result is empty rather than an error

### Requirement: A binary or very large file states so instead of rendering

A file the diff reports as binary SHALL be stated as binary, with no attempt to render its content.

A file whose change is larger than the explorer renders SHALL be stated as too large to render rather
than rendered, its header — path, status, added and removed counts — still shown.

#### Scenario: A binary file

- **WHEN** an opened file is binary
- **THEN** the explorer says so, and shows no diff content for it

#### Scenario: A very large file

- **WHEN** an opened file's change is larger than the explorer renders
- **THEN** the explorer says so, and still shows that file's header

### Requirement: Diff content is read-only, from the forge or the daemon's own clone

Diff content SHALL come from a read-only server endpoint. It SHALL use the project's forge when the
forge can supply it, and SHALL fall back to a diff computed in the daemon's own clone of the
repository — comparing the pull request's base and head branches directly — when the forge cannot: has
no forge, is not authenticated, or the head branch is only ever reachable that way.

The endpoint SHALL cache what it read for the same window the pull requests list already uses, and
SHALL be invalidated by the same events, so opening a pull request's diff does not read the forge, or
recompute the clone diff, on every render.

Nothing in the diff view SHALL offer to edit a file, comment on it, suggest a change, approve it or
merge it. Approval SHALL remain the decision card's alone.

#### Scenario: Served from the forge

- **WHEN** a project's forge can supply a pull request's diff
- **THEN** the diff shown came from the forge

#### Scenario: Served from the daemon's own clone

- **WHEN** a project has no forge, or its forge is not authenticated, and the pull request's head
  branch exists in the daemon's own clone
- **THEN** the diff is still shown, computed from that clone

#### Scenario: Neither source can answer

- **WHEN** the forge cannot supply a pull request's diff and its head branch is not in the daemon's
  own clone
- **THEN** the explorer says the diff is not available, without an error or an endless retry

#### Scenario: Cached like the rest of the pull request

- **WHEN** a pull request's diff is opened twice within the pull requests cache window
- **THEN** the forge is read, or the clone diff computed, once

#### Scenario: Refreshed on the same events that refresh the list

- **WHEN** a ticket of the project records a work product or changes its merge state
- **THEN** a cached diff for that project's pull requests is discarded along with the rest of that
  project's cache

#### Scenario: Read-only throughout

- **WHEN** a pull request's diff is open
- **THEN** nothing on screen offers to edit, comment on, suggest a change to, approve or merge any of
  it

### Requirement: The diff view reads on a phone and on a desktop

The diff view SHALL be usable within the overview's section layout at a phone width and a desktop
width without a horizontal-scroll trap, keeping the section's own collapse behaviour.

#### Scenario: Phone width

- **WHEN** a pull request's diff is opened at a phone width
- **THEN** it is usable in a single column, with no horizontal scrolling required to read a line

### Requirement: Highlighting never changes what the diff says

Syntax highlighting SHALL be a rendering concern only. The lines, addition/removal markers, line
numbers and structure a diff shows SHALL be identical whether or not the file's language is
highlighted.

#### Scenario: Highlighting does not alter diff content

- **WHEN** a changed file's language is highlighted, partially highlighted, or not recognised at all
- **THEN** the diff shows exactly the same lines, additions and removals in every case
