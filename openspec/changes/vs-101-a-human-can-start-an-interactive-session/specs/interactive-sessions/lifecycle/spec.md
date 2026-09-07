## Purpose
Defines what stays true around an interactive session once it is running: it is visible wherever a
worker is, the conductor can read it but never join it, ending it leaves its ticket in a known state
with its worktree kept, an idle session ends itself the same way, and nothing about restart recovery,
permissions or approval gates needs to know it is a session at all — because it is a worker.

## ADDED Requirements

### Requirement: A session is visible wherever a worker is, marked interactive

The system SHALL mark a ticket that is an interactive session wherever that ticket or its worker is
listed or displayed, so it can be told apart from an ordinary ticket at a glance.

#### Scenario: In the ticket and worker listings

- **WHEN** a human or the conductor lists tickets or workers that include an interactive session
- **THEN** that ticket and its worker are marked as an interactive session

### Requirement: The conductor can read a session but is refused if it tries to message one

The conductor SHALL be able to inspect an interactive session's run and read its ticket exactly as it
can any worker's. The conductor SHALL be refused, with a reason, if it attempts to send a message to
an interactive session's agent; a human's own message is unaffected by this refusal.

#### Scenario: The conductor reads a session

- **WHEN** the conductor inspects the run or reads the ticket of an interactive session
- **THEN** it receives the same information it would for any worker's ticket

#### Scenario: The conductor is refused a message

- **WHEN** the conductor attempts to send a message to an interactive session's agent
- **THEN** the attempt is refused with a reason, and no message is delivered or recorded as coming
  from the conductor

#### Scenario: A human's message is unaffected

- **WHEN** a human sends a message to an interactive session's agent
- **THEN** it is recorded and delivered exactly as a message to any worker's ticket is

### Requirement: Ending a session leaves its ticket in a stated status with its worktree intact

Ending an interactive session SHALL leave its ticket in whatever status the action leaves any worker's
ticket in, and SHALL leave its worktree in place rather than removing it. Discarding an interactive
session's worktree, landed or not, SHALL still require the same explicit human confirmation any
worktree discard requires.

#### Scenario: Ending a session

- **WHEN** a human ends an interactive session
- **THEN** its ticket is left in a stated status and its worktree remains in place

#### Scenario: Discarding still requires explicit confirmation

- **WHEN** a human discards an interactive session's worktree
- **THEN** the discard proceeds only with the same explicit confirmation any worktree discard requires

### Requirement: An idle session ends itself, worktree kept

Where an interactive session's agent has had no turn run and no turn executing for a stated quiet
period, the system SHALL end it the same way a human ending it would — leaving its ticket in a stated
status and its worktree in place. It SHALL NOT end a session whose turn is currently executing,
whatever its last activity looks like.

#### Scenario: A session left idle

- **WHEN** an interactive session has had no turn run and none executing for the stated quiet period
- **THEN** it is ended, its ticket left in a stated status, and its worktree kept

#### Scenario: A session with a turn in progress

- **WHEN** an interactive session's agent has a turn currently executing
- **THEN** it is not ended by the idle rule, regardless of how long ago its previous turn finished

### Requirement: Permissions, approval gates and restart recovery need no special case for a session

An interactive session's role permission mode, allowed and denied tools (outside its first turn),
merge approval, and recovery from a daemon restart SHALL be identical to an ordinary worker's, because
it is one. Nothing about being a session SHALL widen what its agent may do or bypass an approval gate.

#### Scenario: Merge approval is unaffected

- **WHEN** an interactive session's ticket reaches the point of merging
- **THEN** it goes through the same merge approval any ticket goes through

#### Scenario: A daemon restart

- **WHEN** the daemon restarts while an interactive session's agent has a run in progress
- **THEN** that run is recovered exactly as any worker's interrupted run is recovered
