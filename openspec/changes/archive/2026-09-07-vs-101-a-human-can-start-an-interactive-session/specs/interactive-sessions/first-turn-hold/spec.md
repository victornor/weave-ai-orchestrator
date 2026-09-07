## Purpose
Defines what an interactive session's agent is allowed to do before the human has said anything: read
its ticket, say what it understands and is ready to do, and stop — enforced by what tools the runtime
will actually run, not by how the prompt is worded, so the hold is a fact rather than a hope.

## ADDED Requirements

### Requirement: The agent's first turn is restricted to reading and reporting

On an interactive session's agent's first turn, the system SHALL restrict the tools available to it,
at the runtime level, to reading its ticket and documents, checking its worktree, and posting one
ticket comment. It SHALL NOT make available any tool that edits a file, runs a command, transitions
the ticket, opens or manages a pull request, or otherwise changes anything outside its own ticket
comment.

Where the agent's role already denies one of the tools this restriction would otherwise allow, the
role's denial SHALL still apply — the restriction narrows what a turn may do; it SHALL NOT widen it
beyond the role's own permission.

#### Scenario: The first turn cannot edit or run anything

- **WHEN** an interactive session's agent takes its first turn
- **THEN** no tool that edits a file, runs a command, transitions the ticket or manages a pull request
  is available to it

#### Scenario: The role's own denial still applies

- **WHEN** an interactive session's agent's role denies a tool that the first-turn restriction would
  otherwise allow
- **THEN** that tool remains unavailable on the first turn

### Requirement: The first turn states understanding and readiness, then stops

An interactive session's agent SHALL be instructed, on its first turn, to read its ticket and its
existing context, post one ticket comment stating what it understands the ticket to be and what it is
ready to do, and take no further action that turn.

#### Scenario: The opening comment

- **WHEN** an interactive session's agent completes its first turn
- **THEN** a ticket comment exists stating its understanding of the ticket and what it is ready to do,
  and no other change has been made

### Requirement: Every turn after the first is an ordinary worker turn

From the human's first message onward — delivered mid-turn or queued exactly as any message to a
worker is (VS-99) — an interactive session's agent SHALL be given its role's ordinary permission mode,
allowed and denied tools, with no restriction beyond the role's own. It SHALL manage its ticket exactly
as any worker does: writing a plan, opening a pull request, transitioning the ticket, commenting, or
recording a document, on request.

#### Scenario: The second turn is unrestricted

- **WHEN** an interactive session's agent takes its second turn, following the human's first message
- **THEN** its tools are exactly its role's ordinary permission mode, allowed and denied tools — the
  first-turn restriction no longer applies

#### Scenario: The agent manages its own ticket afterward

- **WHEN** the human asks an interactive session's agent, after its first turn, to write a plan, open
  a pull request, move the ticket or record a document
- **THEN** it does so on its own ticket exactly as a worker would
