## ADDED Requirements

### Requirement: An open decision closes when its ticket reaches a terminal status

When a ticket reaches `done` or `cancelled`, every decision still `open` on that ticket SHALL be
withdrawn, whatever kind of decision it is, so it stops asking its owner to act on a ticket that is
already finished. The withdrawal SHALL record why the decision closed without an answer, so it is
auditable later that no one refused or ignored it — its ticket simply finished first.

A decision that has already left `open` status by the time its ticket reaches a terminal status —
answered, expired, superseded, or already withdrawn — SHALL be left exactly as it is.

A decision that carries no `ticketId` — a role hire or retirement approval, a workspace-wide
question, or a runtime-wide notice — is not scoped to any ticket's lifecycle and SHALL NOT be
affected by any ticket reaching a terminal status.

This applies uniformly to every decision kind that can carry a ticket id — `plan_approval`,
`merge_approval`, `retry_approval`, `gate_finding`, `question`, and `concern` — since each one exists
only to decide something about that specific ticket's own progress, and none of them has anything
left to decide once the ticket is done or cancelled.

#### Scenario: An open merge approval closes when its ticket is done

- **WHEN** a ticket carrying an open `merge_approval` decision reaches `done`
- **THEN** the decision's status becomes `withdrawn` and it no longer appears in a query for `open`
  decisions

#### Scenario: An open plan approval closes when its ticket is cancelled

- **WHEN** a ticket carrying an open `plan_approval` decision reaches `cancelled`
- **THEN** the decision's status becomes `withdrawn`

#### Scenario: An already-answered decision is left alone

- **WHEN** a ticket reaches `done` or `cancelled` and one of its decisions was already `answered`
- **THEN** that decision's status, answer and answered-at fields are unchanged

#### Scenario: A decision not tied to any ticket survives every ticket's terminal transition

- **WHEN** a `hire_approval` decision, which is tied to a role rather than a ticket, is open
- **THEN** no ticket reaching `done` or `cancelled` withdraws it
