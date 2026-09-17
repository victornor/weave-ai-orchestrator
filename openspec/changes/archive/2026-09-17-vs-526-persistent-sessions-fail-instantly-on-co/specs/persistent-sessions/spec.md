## ADDED Requirements

### Requirement: A persistent session's home can start every runtime

A ticketless persistent session's home directory SHALL be initialised as a git repository before its
first turn, so a runtime that refuses to start outside a git repository can start. It SHALL remain
the session's working directory and SHALL hold the session's rendered instructions, which SHALL NOT
be treated as repository content. The working directory SHALL be established when the session is
opened and SHALL also be ensured when an existing session is opened again, so a session created
before this behaviour still starts.

#### Scenario: A session home is a git repository before the first turn

- **WHEN** a persistent session is opened for a project whose directory is not a git repository
- **THEN** its home is a git repository with one commit before any runtime is spawned

#### Scenario: Reopening an existing session ensures the same

- **WHEN** an existing persistent session is opened again
- **THEN** its home is ensured to be a git repository, and an existing repository is left untouched

#### Scenario: The session's own instructions are not repository content

- **WHEN** the session's rendered instructions are written into its home
- **THEN** the repository's status does not show them as changes

#### Scenario: Every configured runtime starts a ticketless session, or is named

- **WHEN** each runtime configured on a daemon is used to run a ticketless persistent-session turn
- **THEN** either the turn starts, or the runtime is reported as unable to start one, naming the
  runtime and the reason

### Requirement: A failed runtime start states why

When a turn's runtime exits without producing a structured turn result, the cause the runtime wrote
to its error stream SHALL be recorded on the run and SHALL be shown wherever that run's failure is
shown, in place of a bare failure status. A runtime that exits non-zero before producing any turn
output SHALL be reported with the runtime's own message as the failure reason.

#### Scenario: An instant runtime exit shows the runtime's own message

- **WHEN** a session's runtime exits non-zero before emitting any turn output, writing a reason to
  its error stream
- **THEN** the run's failure reason is that message, and the session's surface shows it rather than
  only `failed`

#### Scenario: A failure with no runtime message still names the runtime and exit

- **WHEN** a runtime exits non-zero and wrote nothing to its error stream
- **THEN** the run's failure names the runtime and the exit status, not an empty reason

### Requirement: A persistent session's worker option is chosen and can be changed

A persistent session SHALL run on a worker option from the effective worker-options catalog. The
option SHALL be selectable when the session is opened and the current option SHALL be visible on
the session's own surface. The option SHALL be changeable after the session exists, taking effect
on the session's next turn. An option's runtime, model and effort SHALL govern the session's turns
the same way a ticket's option governs a worker's.

#### Scenario: Choosing an option when the session is opened

- **WHEN** a human opens a role's persistent session and a worker option is available in the catalog
- **THEN** the human can choose the option the session will run on, and the session's turns use it

#### Scenario: The session shows its current option

- **WHEN** a human opens the surface of an existing persistent session
- **THEN** the surface shows the worker option currently governing the session

#### Scenario: Changing the option takes effect on the next turn

- **WHEN** a human changes a persistent session's worker option
- **THEN** the session's next turn is launched on the new option's runtime, model and effort

### Requirement: A change that moves the session's runtime restarts the conversation, and the surface says so first

A session handle belongs to the runtime that issued it. When a worker-option change keeps the
session on the same runtime, the session SHALL be kept and its conversation history preserved.
When a change moves the session to a different runtime, the system SHALL retire the current session
and start a new one on the new runtime, so the conversation visibly restarts with no prior context.
Before the change is applied, the surface SHALL tell the human which of these will happen, naming
the effect on the conversation history, and the change SHALL only be applied after that statement
has been shown.

#### Scenario: A same-runtime change keeps the conversation

- **WHEN** a human changes a session's worker option to one on the same runtime
- **THEN** the session and its conversation history are preserved, and the next turn continues it

#### Scenario: A runtime change is announced before it happens

- **WHEN** a human is about to change a session's worker option to one on a different runtime
- **THEN** the surface states that the conversation will restart on the new runtime and the current
  history will not carry over, before the change is applied

#### Scenario: A runtime change starts a fresh conversation

- **WHEN** a session's worker option is changed to one on a different runtime and the session's next
  turn runs
- **THEN** a new session is started on the new runtime, the prior conversation is not resumed, and
  the session's surface shows the conversation restarted

#### Scenario: Changing back is another new start, not a resumed history

- **WHEN** a session that has already moved to a new runtime is changed back to a previously used
  runtime
- **THEN** it starts a new conversation on that runtime rather than resuming the thread it used
  before the move, and the surface states this before the change is applied
