## ADDED Requirements

### Requirement: The human can open a conversation with the worker that produced a PR

From a merge-approval decision card and from a pull request's entry in the project overview, the
system SHALL let the human open a conversation with the specific worker that produced that PR — the
same agent, with its own session and its own context, never a freshly spawned one standing in for it.

When that worker's session cannot be resumed, the system SHALL say so plainly in the conversation
rather than silently starting a different agent or implying continuity it cannot deliver.

#### Scenario: Opening the conversation from the merge-approval card

- **WHEN** the human opens the conversation from a `merge_approval` decision card
- **THEN** it opens on the worker that was asked that decision, not a substitute

#### Scenario: Opening the conversation from the pull request view

- **WHEN** the human opens the conversation from a pull request's entry in the project overview
- **THEN** it opens on the worker whose ticket produced that pull request

#### Scenario: The worker's session cannot be resumed

- **WHEN** the human opens a conversation with a worker whose session is no longer resumable
- **THEN** the conversation says so plainly before or as the human starts typing, rather than
  silently continuing as if the context were intact

### Requirement: The conversation is delivered like any other message to a running agent

A message the human sends in this conversation SHALL be delivered exactly as any other human message
to a running agent is: reaching the worker's current turn where the runtime allows it, queued for its
next turn otherwise, and the human told which of the two happened.

#### Scenario: The worker is mid-turn

- **WHEN** the human sends a message while the worker's turn is executing and able to receive input
- **THEN** the message reaches that turn and the human is told it arrived immediately

#### Scenario: The worker is idle awaiting review

- **WHEN** the human sends a message while the worker has no turn executing
- **THEN** the message is queued for the worker's next turn and the human is told so

### Requirement: The whole exchange is recorded on the ticket, attributed

Every message either side sends in this conversation SHALL be recorded on the ticket the PR belongs
to, attributed to who sent it, so the conductor and any later reader can see what was asked and what
was answered without needing to have been present.

#### Scenario: A later reader sees the exchange

- **WHEN** the conductor or a human later reads the ticket the conversation happened on
- **THEN** every message either side sent is there, in order, each attributed to its sender

### Requirement: The conversation ends by approving the merge or asking for revisions, and no other way

From inside the conversation, the human SHALL be able to end it by taking exactly one of two actions:
approving the merge, which answers the ticket's open merge approval exactly as approving it from its
card does, or asking for revisions, which answers that same decision on its revision path and sends
the human's words to the worker as the instruction to act on. The conversation SHALL offer no third
action that lands or rejects the work.

#### Scenario: Approving from inside the conversation

- **WHEN** the human approves the merge from inside the conversation
- **THEN** the ticket's open merge approval is answered as approved, exactly as it would be from its
  own card

#### Scenario: Asking for revisions from inside the conversation

- **WHEN** the human asks for revisions from inside the conversation, with their words
- **THEN** the ticket's open merge approval is answered on its revision path, and the worker receives
  those words as the instruction to act on

#### Scenario: No side channel for landing or rejecting work

- **WHEN** the human is offered actions inside the conversation
- **THEN** the only two that end it are approving the merge and asking for revisions

### Requirement: Asking a question changes nothing else

Sending a message in this conversation SHALL NOT widen what the worker may do, SHALL NOT answer any
decision other than the merge approval the human explicitly answers from inside it, and SHALL NOT
merge anything by itself.

#### Scenario: A question leaves other decisions untouched

- **WHEN** the human sends a message in the conversation while another decision on the ticket is open
- **THEN** that other decision remains open and unanswered

#### Scenario: A question never merges by itself

- **WHEN** the human sends any number of messages in the conversation without taking the approve or
  revise action
- **THEN** the ticket is not merged and its merge approval remains open

### Requirement: A worker awaiting review is not retired while its conversation is open

The system SHALL NOT retire a worker whose ticket has not reached a terminal status, so a worker
sitting in review with an open conversation is never retired out from under it.

#### Scenario: A worker in review during a conversation

- **WHEN** a worker's ticket is awaiting review or merging, and a conversation with it is open
- **THEN** the worker is not retired

### Requirement: A conversation on work that has already landed is read-only

Once the worker that produced a PR has retired, the system SHALL keep that ticket's recorded exchange
readable, naming which worker it was, and SHALL refuse to send it a new message rather than accepting
one it will never receive. The refusal SHALL be shown as a clear note, not as a silent queue.

#### Scenario: Reading a conversation after the ticket merged

- **WHEN** the human opens the conversation on a ticket whose worker has since retired
- **THEN** the past exchange is shown, naming that worker, and no composer offers to send it a new
  message

#### Scenario: Sending is refused, not swallowed

- **WHEN** a message is attempted against a worker that has retired
- **THEN** it is refused with a clear reason rather than recorded as if it were queued for a turn
  that will never come

### Requirement: The conversation works on the phone

The conversation SHALL be reachable from the merge-approval card and the pull request view on a phone
screen, and its composer SHALL behave the way the rest of the application's chat composer does.

#### Scenario: Opening the conversation on a phone

- **WHEN** the human opens the conversation from either entry point on a phone-sized screen
- **THEN** the conversation and its composer are usable exactly as they are on a larger screen
