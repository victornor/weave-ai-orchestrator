## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Highlighting never changes what the diff says

Syntax highlighting SHALL be a rendering concern only. The lines, addition/removal markers, line
numbers and structure a diff shows SHALL be identical whether or not the file's language is
highlighted.

#### Scenario: Highlighting does not alter diff content

- **WHEN** a changed file's language is highlighted, partially highlighted, or not recognised at all
- **THEN** the diff shows exactly the same lines, additions and removals in every case
