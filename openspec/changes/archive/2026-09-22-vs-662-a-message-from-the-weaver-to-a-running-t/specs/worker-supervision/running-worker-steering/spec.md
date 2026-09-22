## Purpose

Defines how a steer reaches a worker whose turn is already running: it is delivered immediately — into the running turn where the runtime has an open mid-turn channel, otherwise by stopping the turn and resuming the same session with the message — so a correction is never left waiting behind the work it is meant to change, whichever surface or sender it came from, and rapid steers collapse into the one turn that resumes the worker.

## ADDED Requirements

### Requirement: A steer to a running ticket worker is never queued behind its turn

A **steer** is the words a human or the conductor sends to a ticket-bound worker to direct its work: the conductor's `weave_worker_message`, a human's message in the worker's live view, a human's message or comment on the ticket (including a chat message that lands on it), and a human's answer to a decision the worker asked.

When a steer is sent to a ticket-bound worker whose turn is executing, the system SHALL deliver it immediately: into the executing turn where that turn has an open mid-turn channel, and otherwise by interrupting the executing turn and starting the worker's next turn on the same session carrying the message. The steer SHALL NOT be queued behind the executing turn.

A steer sent to a worker with no turn executing SHALL be queued for the worker's next turn, as before, and a request not to attempt mid-turn delivery SHALL queue it regardless.

#### Scenario: The conductor's steer reaches a running worker

- **WHEN** the conductor steers a ticket-bound worker whose turn is executing and whose runtime has no open mid-turn channel
- **THEN** the executing turn is interrupted and the worker's next turn resumes the same session carrying the message

#### Scenario: A human's comment on the ticket reaches a running worker

- **WHEN** a human comments on a ticket whose worker's turn is executing
- **THEN** the executing turn is interrupted and the worker's next turn resumes the same session carrying the comment, instead of the comment waiting behind the turn

#### Scenario: A human's message in the live view reaches a running worker

- **WHEN** a human sends a message to a worker in its live view while its turn is executing
- **THEN** it is delivered immediately under this requirement, never queued behind the turn

#### Scenario: An answered decision reaches a running worker

- **WHEN** a human answers a decision a ticket-bound worker asked while that worker's turn is executing
- **THEN** the executing turn is interrupted and the worker's next turn resumes the same session carrying the answer

#### Scenario: A worker between turns queues the steer

- **WHEN** a steer is sent to a ticket-bound worker with no turn executing
- **THEN** it is queued and delivered at the start of the worker's next turn

#### Scenario: An explicit request to queue is honoured

- **WHEN** a steer is sent with an explicit request not to attempt delivery to the running turn
- **THEN** it is queued for the worker's next turn even though a turn is executing

### Requirement: A steer that cannot be delivered mid-turn interrupts the turn and resumes the same session

Where the executing turn has an open mid-turn channel the steer SHALL be delivered into that turn and the turn SHALL be left running. Where it has no open channel — the runtime does not support mid-turn input, or the turn never opened one — the system SHALL interrupt the executing turn with the same stop the runtime's own interactive Escape performs, and SHALL start the worker's next turn on the same runtime session, so the worker keeps its context and sees what it had already done. The interrupted turn SHALL remain in the transcript marked interrupted, with the tool calls it cut off marked not completed (see `run-transcripts/interrupted-turn`).

#### Scenario: An open channel takes the steer without stopping the turn

- **WHEN** a steer is sent to a running worker whose executing turn has an open mid-turn channel
- **THEN** the message is delivered into that turn and the turn is not interrupted

#### Scenario: No channel means stop now

- **WHEN** a steer is sent to a running worker whose executing turn has no mid-turn channel
- **THEN** the turn is interrupted now and the worker's next turn resumes the same session with the message

#### Scenario: The interrupted turn is kept and marked

- **WHEN** a steer interrupted the worker's turn
- **THEN** the turn's transcript stays visible, marked interrupted, and its cut-off tool calls read not completed

### Requirement: Rapid steers coalesce into one resumed turn

Steers that arrive while a ticket worker's turn is stopping for an earlier steer SHALL be coalesced into the single turn that resumes the worker, in the order they were sent. A later steer SHALL NOT interrupt again while the turn stopped for an earlier steer is still stopping, and no steer SHALL be delivered more than once.

#### Scenario: Two rapid steers start one turn

- **WHEN** a second steer is sent before the interrupted turn has stopped and the resumed turn has started
- **THEN** exactly one resumed turn runs, carrying both messages in order

#### Scenario: Each steer is delivered exactly once

- **WHEN** several steers were sent during the interrupt
- **THEN** each appears exactly once in the resumed turn

#### Scenario: A steer after the resumed turn starts is a new interrupt

- **WHEN** a steer is sent after the resumed turn has already started
- **THEN** it interrupts that turn under the same rule, rather than being appended to it

### Requirement: A wake that is not a steer is unaffected

A wake that carries no human or conductor words — a ticket assignment, a retry, a system or routine wake, a plan submission, a completed blocker or child, or any other system-generated wake — SHALL keep its existing delivery and SHALL NOT interrupt a running turn. The ticketless-session behaviour from VS-657 and the weaver's own chat are unchanged.

#### Scenario: A system wake queues as before

- **WHEN** a system-generated wake is enqueued for a ticket-bound worker whose turn is executing
- **THEN** the turn is left running and the wake waits, exactly as before this rule

#### Scenario: The weaver's chat is unchanged

- **WHEN** a human's message reaches the weaver while its turn is executing
- **THEN** it queues as before, and the weaver's turn is not interrupted