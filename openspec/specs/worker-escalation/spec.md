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

### Requirement: Escalating a worker's ask leaves the worker's decision open and answerable

When a worker's `question` or `concern` cannot be resolved by the conductor and the conductor
escalates it to the human by raising its own ask about the same ticket, the two decisions SHALL be
treated as distinct objects: they carry different owners (the worker's ask is the conductor's, the
escalation is the human's) and SHALL both remain `open` at the same time. Neither SHALL supersede the
other. The same SHALL hold when the worker's ask is a `gate_finding`, whose escalation to the human
is necessarily a different kind because a `gate_finding` is always owned by the conductor.

Once the human answers the conductor's escalation, the conductor SHALL be able to answer the
worker's own decision — the one it originally left open — and the worker SHALL be woken with that
answer, exactly as with a direct answer. The worker's decision SHALL NOT have been closed by the act
of escalating.

Deduplication SHALL be preserved: a repeat ask of the same kind, by the same owner, on the same
ticket SHALL still supersede the earlier `open` decision of that kind and owner, so repeated asks do
not stack.

#### Scenario: A worker's question and the conductor's escalation coexist

- **WHEN** a worker raises a `question` on a ticket and the conductor then raises its own `question`
  to the human about the same ticket
- **THEN** both decisions are `open` at the same time
- **AND** neither has superseded the other

#### Scenario: A worker's concern and the conductor's escalation coexist

- **WHEN** a worker raises a `concern` on a ticket and the conductor then raises its own `concern`
  to the human about the same ticket
- **THEN** both decisions are `open` at the same time
- **AND** neither has superseded the other

#### Scenario: A worker's gate finding survives its escalation

- **WHEN** a worker raises a `gate_finding` on a ticket and the conductor escalates it to the human
  with its own ask (necessarily a kind the human can own, since a `gate_finding` is the conductor's)
- **THEN** the worker's `gate_finding` remains `open`
- **AND** the conductor's escalation is `open` as well

#### Scenario: The human's answer is relayed onto the worker's decision

- **WHEN** the human answers the conductor's escalation and the conductor then answers the worker's
  decision
- **THEN** the worker's decision is `answered` with that resolution
- **AND** the worker is woken with the answer without needing a relaunch

#### Scenario: A repeated ask by the same owner still supersedes

- **WHEN** the same owner raises a second decision of the same kind on the same ticket with no
  explicit correlation key
- **THEN** the earlier `open` decision is `superseded` and a new one is `open`

#### Scenario: A repeat by a different owner does not supersede

- **WHEN** a decision of a given kind is open for one owner on a ticket and a decision of the same
  kind is then created for the other owner on that ticket
- **THEN** the first decision remains `open`

### Requirement: A ticketless ask gets its own bucket, not a shared workspace bucket

An ask raised with no ticket attached — the weaver's own ask to the human, or a ticketless
session's — SHALL NOT be superseded by, and SHALL NOT supersede, another open ticketless decision
unless both were raised with the same explicit `correlationKey`. Two ticketless asks of the same
kind and the same owner, with no explicit correlation key, SHALL both remain `open` regardless of
whether they name the same project, different projects, or no project at all. This holds for every
askable kind (`question`, `concern`, `gate_finding`) — the only kinds `weave_ask` can raise — and
regardless of which agent raises the ask.

A caller that wants a ticketless re-ask to replace an earlier open one on purpose SHALL do so by
passing the same explicit `correlationKey` on both asks; that pair SHALL still supersede.

The dedup a ticket-scoped ask relies on — a repeat ask of the same kind, by the same owner, on the
same ticket, superseding the earlier one with no explicit key — is unaffected by this requirement.

This requirement governs only the default correlation key for the three askable kinds. A
system-raised decision of any other kind (`retry_approval`, `hire_approval`, `merge_approval`,
`plan_approval`, `action_approval`, `discard_approval`, `promotion_approval`) is unaffected, whether
or not it carries a ticket: every such kind is raised only through call sites that already pass their
own explicit `correlationKey`, and this change does not alter the default those kinds would fall back
to if one ever omitted one.

#### Scenario: Two ticketless asks about different projects both stay open

- **WHEN** the weaver raises a ticketless `question` naming project Alpha, and then raises another
  ticketless `question` naming project Beta, neither passing an explicit `correlationKey`
- **THEN** both decisions are `open` at the same time and neither has superseded the other

#### Scenario: Two ticketless asks naming no project at all both stay open

- **WHEN** the weaver raises a ticketless `question` naming no project, and then raises another
  ticketless `question` naming no project, neither passing an explicit `correlationKey`
- **THEN** both decisions are `open` at the same time and neither has superseded the other

#### Scenario: An explicit shared correlation key still supersedes a ticketless ask

- **WHEN** the weaver raises a ticketless ask with an explicit `correlationKey`, and then raises
  another ticketless ask of the same kind and owner with that same explicit `correlationKey`
- **THEN** the earlier decision is `superseded` and the new one is `open`

#### Scenario: The fix applies to concern and gate_finding the same way it applies to question

- **WHEN** two ticketless `concern` asks, or two ticketless `gate_finding` asks, are raised by the
  same owner with no explicit `correlationKey` and no shared project
- **THEN** both decisions are `open` at the same time and neither has superseded the other

#### Scenario: A ticket-scoped repeat ask still supersedes

- **WHEN** the same owner raises a second decision of the same kind on the same ticket with no
  explicit `correlationKey`
- **THEN** the earlier `open` decision on that ticket is `superseded` and the new one is `open`,
  exactly as before this change

#### Scenario: A ticketless retry_approval still supersedes per agent, unaffected by this change

- **WHEN** a ticketless `retry_approval` is raised for one agent, and then another ticketless
  `retry_approval` is raised for the same agent
- **THEN** the earlier decision is `superseded` and the new one is `open`, exactly as today, because
  that call site's own explicit `correlationKey` is untouched by this requirement

#### Scenario: Ticketless retry_approvals for different agents do not collide

- **WHEN** a ticketless `retry_approval` is raised for one agent and a ticketless `retry_approval` is
  raised for a different agent
- **THEN** both decisions are `open` at the same time
