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

### Requirement: The session transcript names each message's author

On a persistent session's ticketless conversation surface, each message SHALL be attributed by who
authored it, not by which direction it travelled. A message the human sent SHALL read as `you`, on
every channel or device it arrived from. A message the session agent produced SHALL be labelled with
the agent's name — the role's name, which is what the human recognises — and never with a generic
`session`, `assistant` or `you`. A message another agent heard from the human and relayed, and a
system notice, SHALL each be labelled for what they are rather than falling back to `you` or to the
session agent's name. No message that is not from the human SHALL be labelled `you`.

#### Scenario: The agent's reply names the agent

- **WHEN** the session's conversation shows a message the session agent produced
- **THEN** it is labelled with the agent's role name, distinct from the human's messages

#### Scenario: The human's message reads as you

- **WHEN** the conversation shows a message the human sent, whatever channel or device it came from
- **THEN** it is labelled `you`

#### Scenario: A relayed message names its author

- **WHEN** the conversation shows a message the weaver relayed
- **THEN** it is labelled as the weaver's message, not as the human's and not as the session agent's

#### Scenario: A system notice is not attributed to the human

- **WHEN** the conversation shows a system-authored notice
- **THEN** it is labelled as a system notice, not `you`

### Requirement: A session's turn answer reaches its conversation thread

A persistent session that holds no ticket and whose turn was woken by a human message SHALL have that turn's final answer delivered to the session's own conversation thread as an outbound message attributed to the session, linked to the human message that woke it, without the session having to call any tool. The delivery SHALL be based on the turn's normalized result, so it behaves the same on every runtime a session can run on.

When the turn already produced an outbound message to that thread — a reply tool the session called — the daemon SHALL NOT add a second message for the same turn. A turn the human did not wake SHALL post nothing.

When a turn the daemon stopped on its own is resumed by a retry wake that carries no thread context, the daemon SHALL resolve the session's own thread for the delivery, and SHALL deliver only while that thread still holds a human message that no `agent`-authored outbound message follows — a system notice is not an answer — so an unrelated turn never answers a message that is no longer waiting, and the stopped attempt's own notice never stands in for the answer.

When the turn's final text is absent or whitespace-only, the daemon SHALL NOT write an answer message; the thread SHALL instead show, as a system notice, that the turn ended without an answer, so the conversation is never left silently blank.

#### Scenario: The answer lands in the thread

- **WHEN** a human messages a ticketless persistent session and its turn succeeds with a final answer
- **THEN** exactly one outbound message carrying that answer appears in the session's thread, attributed to the session

#### Scenario: The answer quotes the message that woke it

- **WHEN** that answer is delivered
- **THEN** it is linked to the human message that woke the turn, and when several human messages were batched into the one turn they are all linked

#### Scenario: A session that answers with a tool is not double-posted

- **WHEN** a session's turn has already written an outbound message to its thread
- **THEN** the daemon adds no second message for that same turn

#### Scenario: A turn the human did not wake is untouched

- **WHEN** a session's turn is woken by something other than a human message, such as a self-scheduled wake or a system repair
- **THEN** no answer is posted to the thread

#### Scenario: A resumed turn that lost its wake context still answers

- **WHEN** a session turn the daemon stopped on its own is resumed by a retry wake that carries no thread context, and the resumed turn succeeds
- **THEN** its answer is delivered to the session's own thread, linked to the human message still waiting there

#### Scenario: The stopped attempt's own notice does not stand in for the answer

- **WHEN** a stopped session turn posted its own system notice and its retry-woken resume then succeeds
- **THEN** the human's message is answered — the answer appears after that notice, linked to the message — so the notice is never the last word

#### Scenario: An unrelated turn does not answer a stale message

- **WHEN** a session's own thread ends in a human message the daemon stopped on its own, and an unrelated turn (a self-scheduled or system wake) runs without a retry
- **THEN** that turn posts nothing, because the fallback applies to a resume, not to any turn that finds an old message

#### Scenario: An empty answer is not a blank thread

- **WHEN** a session's turn ends with no final text or only whitespace
- **THEN** no answer message is written, and the thread states as a system notice that the turn ended without an answer

#### Scenario: Every runtime behaves the same

- **WHEN** a session runs a human-woken turn on any configured runtime and it succeeds with a final answer
- **THEN** the answer is delivered to the thread, because delivery reads the normalized turn result rather than a runtime-specific stream

### Requirement: A session's turn that ends without an answer states why

When a human-woken ticketless persistent session's turn ends without an answer — failed, timed out, cancelled or interrupted — the daemon SHALL post one system-authored notice to the session's thread naming the plain reason, without run ids or internals. A turn that will be retried by the retry ladder, or resumed from the same wake after a daemon shutdown or a live human message, SHALL NOT be announced until its final outcome is known; a turn that is retried or resumed and then succeeds SHALL post its answer exactly once. A watchdog cut SHALL announce itself — there is no reliable signal at that moment that a resume is coming — and its later resume SHALL answer past that notice (the requirement above), so the notice is never the last word.

A notice for a usage limit SHALL name the limit, SHALL give the reset instant when the runtime reported one, and SHALL state that nothing retries a usage limit automatically, so another message is needed. A notice for an expired runtime login SHALL say that a new login is needed and what happens next — that the conversation resumes once the login is renewed, or, when the outage has exhausted the automatic recovery and parked the work, that the human must log in and retry.

#### Scenario: A failed turn says why

- **WHEN** a human-woken session turn ends failed
- **THEN** the thread shows one system notice naming the plain reason, with no run id

#### Scenario: A stopped turn says why

- **WHEN** a human-woken session turn times out, is cancelled, or is interrupted by the watchdog
- **THEN** the thread shows a system notice that the turn was stopped before it could answer

#### Scenario: A retried or resumed turn is not announced early

- **WHEN** a session turn ends in a way the daemon retries or resumes from the same wake, such as a transient provider failure with retries remaining, a daemon shutdown, or a live human message that interrupts it
- **THEN** no notice is posted for that attempt

#### Scenario: A retried turn that then succeeds answers once

- **WHEN** a session turn is retried and a later attempt succeeds with a final answer
- **THEN** the retry's answer is posted, and no notice was posted for the retryable attempt itself

#### Scenario: A usage-limit notice gives the reset and the next step

- **WHEN** a session turn is stopped by a runtime usage limit, with or without a reset the runtime reported
- **THEN** the notice names the usage limit, gives the reset when there is one, and says that nothing retries automatically so another message is needed

#### Scenario: An expired login says what happens next

- **WHEN** a session turn ends because the runtime's login expired
- **THEN** the notice says a new login is needed and whether the conversation resumes once it is renewed or the human must log in and retry

#### Scenario: A resumed turn's failure is stated once

- **WHEN** a session turn the daemon stopped on its own is resumed by a retry wake and that resumed turn finally fails
- **THEN** exactly one notice is posted for the resumed turn, after whatever the stopped attempt itself posted
