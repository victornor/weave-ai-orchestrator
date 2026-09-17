## ADDED Requirements

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
