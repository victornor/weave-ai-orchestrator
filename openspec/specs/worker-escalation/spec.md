# worker-escalation Specification

## Purpose
Defines how a worker reaches someone when it has a question, a concern, or is stuck: every such ask
is owned by the conductor rather than the human, it wakes the conductor immediately rather than at
the next digest, and a worker blocked on the conductor is surfaced the same way.

## Requirements

### Requirement: A worker's ask is owned by the conductor, whatever kind it names

A decision an agent of kind `worker` raises SHALL be owned by the conductor, regardless of which
decision kind the worker names. A worker SHALL NOT be able to place a decision in the human's queue
by choosing a kind, or by any other input to the tool that raises it. The conductor's own use of the
same tool to reach the human is unaffected: a decision an agent of kind `conductor` raises SHALL keep
being owned by the human.

#### Scenario: A worker's default ask lands on the conductor

- **WHEN** a worker raises a decision without naming a kind
- **THEN** the decision is owned by the conductor

#### Scenario: A worker cannot pick its way to the human's queue

- **WHEN** a worker raises a decision naming any kind the tool accepts
- **THEN** the decision is owned by the conductor in every case

#### Scenario: The conductor still reaches the human

- **WHEN** the conductor raises a decision through the same tool it always has
- **THEN** the decision is owned by the human, exactly as before this change

### Requirement: The tool a worker asks with cannot construct a system-owned approval

`plan_approval`, `merge_approval`, `hire_approval`, `discard_approval`, `retry_approval` and the
generic `approval` kind SHALL NOT be constructible through the general-purpose ask tool available to
workers and the conductor. Those kinds continue to be raised only by the system paths that already
create them today (plan validation, merge readiness, hiring, retirement, retry exhaustion), each
setting its own owner directly.

#### Scenario: A worker cannot forge an approval-shaped decision

- **WHEN** a worker or the conductor calls the ask tool naming `plan_approval`, `merge_approval`,
  `hire_approval`, `discard_approval`, `retry_approval` or `approval` as the kind
- **THEN** the call is refused before any decision is created

#### Scenario: A real approval is unaffected

- **WHEN** a ticket's plan validates, its work product is ready to merge, a role hire is proposed, a
  role's retirement is proposed, or a worker's retries are exhausted
- **THEN** the corresponding approval decision is raised exactly as it is today, with its existing
  owner

### Requirement: A worker can raise a concern without inventing a decision

A worker facing a genuine obstacle — it is stuck, it needs feedback, the ticket's own instructions
turn out to be insufficient — SHALL have a way to say so that carries the situation, what it already
tried, and what would unblock it, without being required to frame the situation as a choice between
options. This ask SHALL reach the conductor the same way any other worker ask does.

#### Scenario: A worker raises a concern with no options

- **WHEN** a worker raises this kind of ask, giving only the situation and what would help, with no
  options and no recommendation
- **THEN** the ask is accepted, requires no options, and is owned by the conductor

### Requirement: The conductor wakes immediately when a worker's ask lands on it

Raising a decision owned by the conductor SHALL wake the conductor before its next turn, not only at
its next periodic digest, whatever kind the decision carries.

#### Scenario: A worker's question wakes the conductor now

- **WHEN** a worker raises any ask that resolves to conductor ownership
- **THEN** the conductor is woken immediately, in the same way it already is for a `gate_finding`

### Requirement: A ticket blocked on the conductor wakes it immediately

A ticket transitioned to `blocked` with its unblock action owned by the conductor SHALL wake the
conductor immediately, in the same transition, rather than relying on it to be noticed at the next
periodic digest.

#### Scenario: A worker blocks itself on the conductor

- **WHEN** a ticket transitions to `blocked` and names the conductor as the owner of what unblocks it
- **THEN** the conductor is woken immediately, naming the ticket and the unblock action

#### Scenario: A ticket blocked on the human is unaffected

- **WHEN** a ticket transitions to `blocked` and names the human as the owner of what unblocks it
- **THEN** this requirement makes no additional wake; the ticket is surfaced to the human exactly as
  it is today

### Requirement: An answer to a worker's ask reaches it without a relaunch

When the conductor answers a decision a worker raised, the worker SHALL be woken with the answer on
its own next turn, without needing to be relaunched, and the question and its answer SHALL remain on
the ticket's record. This holds for every kind an ask can now resolve to conductor ownership under —
`question`, `concern` and `gate_finding` alike.

#### Scenario: The conductor answers directly

- **WHEN** the conductor answers a decision a worker raised
- **THEN** the worker is woken with the answer, and the exchange is visible on the ticket

#### Scenario: A concern is answered the same way a question is

- **WHEN** the conductor answers a `concern` a worker raised
- **THEN** the worker is woken with the answer exactly as it would be for a `question` or a
  `gate_finding`
