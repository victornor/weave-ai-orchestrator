## Purpose

Defines what giving a held session back requires of whoever gives it back, and what the system
reconciles and records before the worker returns to ordinary work.

## ADDED Requirements

### Requirement: Giving a session back requires a note

The system SHALL require a note describing what was done before it accepts a human's handback of a
held session. A handback with no note, or an empty one, SHALL be rejected; the hold SHALL remain
open until a note is given.

#### Scenario: Handback without a note is rejected

- **WHEN** a human attempts to give back a held session without a note
- **THEN** the handback is rejected and the hold stays open

#### Scenario: Handback with a note succeeds

- **WHEN** a human gives back a held session with a note describing what they did
- **THEN** the handback succeeds and the note is recorded against the hold

### Requirement: Handback reconciles worktree and session state and records what changed

Giving a session back SHALL compare the worker's worktree and stored session against what they were
when the session was taken, and SHALL record what changed: whether new commits landed, whether the
worktree is left dirty, and whether the runtime's session activity moved on while it was held. This
record, together with the human's note, SHALL be posted where the ticket's own history is read, so
that work done outside the daemon is not a silent gap in that history.

#### Scenario: New commits landed while the session was held

- **WHEN** a session is given back and commits were made to the worktree while it was held
- **THEN** the handback record names that commits were made, and the ticket's history shows it
  alongside the human's note

#### Scenario: Nothing changed while the session was held

- **WHEN** a session is given back and neither the worktree nor the session moved while it was held
- **THEN** the handback record says so, rather than omitting a reconciliation section entirely

#### Scenario: The record reaches the ticket, not just the hold

- **WHEN** a session is given back
- **THEN** the reconciliation and the human's note are readable from the ticket's own history, not
  only from the worker
