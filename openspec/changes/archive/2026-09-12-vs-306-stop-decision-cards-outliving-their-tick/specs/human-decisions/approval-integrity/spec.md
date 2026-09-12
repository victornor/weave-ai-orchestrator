## ADDED Requirements

### Requirement: A decision created on a ticket that is already terminal is not attached to it

When a decision is created naming a ticket whose status is already terminal (`done` or `cancelled`),
the decision SHALL still be created and SHALL be answerable exactly as it would be otherwise, but it
SHALL NOT be attached to that ticket: its ticket reference SHALL be empty. A decision scoped to a
ticket exists to decide something about that ticket's live progress; a decision named at a ticket
that has already finished has no such progress left to decide, and an attachment to it can never be
closed by the terminal transition that has already happened.

The decision SHALL keep the project the terminal ticket belonged to, so it is still grouped with the
work it concerns, and the daemon SHALL record a warning naming the ticket and the decision kind so
the misattached ask is visible rather than silent.

The decision SHALL also keep the correlation-key bucket it would have had while attached, derived
from the ticket it named, so the detached decision neither supersedes nor is superseded by a
workspace-level decision of the same kind. Dropping a ticket's attachment SHALL NOT move the decision
into the shared no-ticket bucket, where it could silently close an unrelated open card.

A decision naming a ticket that is not terminal SHALL keep that ticket attachment, unchanged. A
decision naming no ticket is unaffected.

#### Scenario: A follow-up question asked seconds after its ticket finished

- **WHEN** a `question` is created naming a ticket that reached `done` moments earlier
- **THEN** the decision is created and is open and answerable
- **AND** its ticket reference is empty, so no future terminal transition is needed to close it
- **AND** it keeps the project the finished ticket belonged to
- **AND** it keeps its own correlation-key bucket, derived from the ticket it named

#### Scenario: A detached follow-up does not disturb a workspace-level question

- **WHEN** an open workspace-level `question` exists and a `question` is then created detached from a
  terminal ticket
- **THEN** the workspace-level question stays open
- **AND** a later workspace-level `question` does not supersede the detached one

#### Scenario: A decision on a live ticket keeps its ticket

- **WHEN** a decision is created naming a ticket whose status is not terminal
- **THEN** the decision is attached to that ticket exactly as before

#### Scenario: A decision with no ticket is unaffected

- **WHEN** a decision is created naming no ticket
- **THEN** it is created exactly as before

### Requirement: A stale decision on a terminal ticket is withdrawn without touching a live one

The daemon SHALL sweep for decisions that are still `open`, are attached to a ticket whose status is
already terminal, and are older than a grace period, and SHALL withdraw each of them through the same
withdrawal path a terminal ticket transition uses, so a swept decision is auditable as a withdrawal
with a stated reason and never a new closure mechanism.

The sweep SHALL NOT touch a decision whose ticket is not terminal, whatever kind that decision is.
In particular it SHALL NOT close a `plan_approval`, `merge_approval` or `action_approval` on a ticket
that is live, because a live ticket is exactly the case a gate exists to decide.

The sweep SHALL NOT touch a decision newer than the grace period, so a follow-up asked shortly after
its ticket closed survives long enough to be read and answered.

The sweep SHALL run on the same cadence as the approval-integrity scan, and SHALL be unable to
contend with it: the repair scan re-raises approvals only for tickets that are not terminal, so the
two passes operate on disjoint sets of decisions and neither can undo the other's work.

#### Scenario: A stale card on a finished ticket is withdrawn

- **WHEN** a decision attached to a `done` ticket is older than the grace period and the sweep runs
- **THEN** the decision's status becomes `withdrawn`
- **AND** the withdrawal names why it closed without an answer
- **AND** it no longer appears in a query for `open` decisions

#### Scenario: A fresh card on a finished ticket is left for the grace period

- **WHEN** a decision attached to a terminal ticket is newer than the grace period and the sweep runs
- **THEN** it stays `open`

#### Scenario: A gate on a live ticket is never touched

- **WHEN** a `plan_approval` is open on a ticket in `proposed`, or a `merge_approval` on a ticket in
  `in_review`, and the sweep runs more than once
- **THEN** each stays `open`

#### Scenario: The sweep and the approval repair cannot contend

- **WHEN** the approval-integrity scan has just re-raised an approval for a ticket that is not
  terminal, and the stale sweep then runs
- **THEN** the re-raised approval is untouched
