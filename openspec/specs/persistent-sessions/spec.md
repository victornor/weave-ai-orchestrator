# persistent-sessions Specification

## Purpose
A persistent role session is a long-lived, no-ticket agent — one per role per project — that a human can hold a standing conversation with over days, that survives a daemon restart by resuming rather than restarting, that never competes for or consumes the project's transient-worker capacity, and that can pick up a ticket on request without leaving that standing conversation behind.

## Requirements

### Requirement: One persistent session per role, resumed rather than recreated

The system SHALL support at most one live persistent session per role. Opening a role's session for the first time SHALL create it; opening it again, including after a daemon restart, SHALL resume the same session and its prior conversation rather than starting a new one.

#### Scenario: First open creates the session

- **WHEN** a human opens a role's persistent session for the first time
- **THEN** the system creates one no-ticket agent for that role and the conversation begins with no prior history

#### Scenario: Reopening resumes the same conversation

- **WHEN** a human opens a role's persistent session a second time, in the same daemon lifetime or after a restart
- **THEN** the system resumes the same agent and the same underlying runtime session, and the conversation continues with its prior context intact rather than starting over

#### Scenario: A daemon restart does not recreate it

- **WHEN** the daemon restarts while a role has a live persistent session
- **THEN** the session is resumed on the next turn exactly as any other agent's turn resumes after a restart, and no second session for that role is created

### Requirement: A persistent session never consumes transient worker capacity

A persistent session's agent SHALL NOT be counted by, and SHALL NOT be gated by, any check of the project's transient-worker limit — neither when it is opened, nor while it is idle, nor while it is running a ticketless turn, nor while it is running a turn on a ticket it has taken. A role already at its transient-worker limit SHALL still be able to open and use its persistent session without being refused for being at that limit.

#### Scenario: Opening at the limit

- **WHEN** a role's project already has every transient worker slot in use
- **THEN** a human can still open and converse with that role's persistent session

#### Scenario: Running at the limit

- **WHEN** a role's project already has every transient worker slot in use and that role's persistent session is given a turn to run
- **THEN** the session's turn runs and no transient worker's turn is delayed or refused because of it

#### Scenario: A session's own ticket does not tip the count

- **WHEN** a persistent session has taken a ticket and is running a turn on it
- **THEN** that turn is still not counted against the project's transient-worker limit

### Requirement: Conversation is the default posture until asked to do work

Every turn of a persistent session that has no ticket SHALL be conversational: the agent answers, investigates and explains, and SHALL NOT be instructed to run any ticket delivery phase. The session's instructions SHALL tell it, when the human proposes work, to offer setting up a ticket and a worktree rather than proceeding informally, and SHALL make clear that both are opt-in: the human may decline either, in which case the session keeps working the conversation with no ticket and no worktree.

#### Scenario: A work-shaped request produces an offer, not a ticket

- **WHEN** a human describes work to a role's persistent session and has not asked it to file a ticket
- **THEN** the session offers to set up a ticket and a worktree, and does not create either on its own judgement

#### Scenario: Declining keeps the conversation ticketless

- **WHEN** a human declines the offer of a ticket and worktree
- **THEN** the session continues the conversation with no ticket and no worktree

### Requirement: A persistent session takes a ticket only when asked, and works it under normal gates

When, and only when, the human asks, a persistent session SHALL be able to create a ticket assigned to its own role, take that ticket as its own without going through transient-worker spawning, and be given a worktree for it exactly as a transient worker would be. From that point the session's turns on that ticket SHALL follow the same phase progression, plan-approval gate and merge-approval gate as a transient worker's ticket, with no gate relaxed or skipped because the agent is a persistent session.

Filing the ticket SHALL NOT itself wake the weaver. The plan-approval decision and the merge-approval decision the ticketed work goes through SHALL wake the weaver exactly as they do for a transient worker's ticket.

When the ticket reaches a terminal status, the session SHALL return to being ticketless: its conversation history SHALL continue unchanged, but it no longer holds a ticket or a worktree.

#### Scenario: Filing does not wake the weaver

- **WHEN** a persistent session files and takes a ticket at the human's request
- **THEN** the ticket appears on the work page and the weaver is not woken by its creation

#### Scenario: Plan approval wakes the weaver

- **WHEN** a persistent session's ticket reaches the point of requesting plan approval
- **THEN** the weaver is woken to review it, exactly as it would be for a transient worker's ticket

#### Scenario: Merge approval wakes the weaver

- **WHEN** a persistent session's ticket is ready for merge review
- **THEN** the weaver is woken to review it, exactly as it would be for a transient worker's ticket

#### Scenario: The gates are not relaxed

- **WHEN** a persistent session's ticket is ready to land
- **THEN** it requires the same merge approval a transient worker's ticket requires, and is merged the same way

#### Scenario: Finishing a ticket returns the session to conversation

- **WHEN** a persistent session's ticket reaches a terminal status
- **THEN** the session no longer holds a ticket or a worktree, and its prior conversation remains available in the same session

### Requirement: A running turn can be interrupted and a session can be compacted on demand

A persistent session's running turn SHALL be interruptible mid-turn the same way any running agent's turn can be interrupted. A human SHALL be able to trigger compaction of a persistent session's conversation on demand; that control SHALL invoke the coding runtime's own compaction and SHALL NOT be, or require, a separate summarization or context-tracking mechanism built for this feature.

#### Scenario: Interrupting a running turn

- **WHEN** a human interrupts a persistent session while it is mid-turn
- **THEN** the turn stops the same way interrupting any other running agent's turn stops it, and the session remains usable afterward

#### Scenario: Compacting on demand

- **WHEN** a human triggers the manual compact control on a persistent session
- **THEN** the session's underlying runtime compacts its conversation the same way it does when the runtime's own automatic threshold is reached, and no separate context-management mechanism is invoked

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
