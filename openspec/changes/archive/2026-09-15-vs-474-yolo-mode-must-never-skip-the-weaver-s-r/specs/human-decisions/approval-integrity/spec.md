## MODIFIED Requirements

### Requirement: A ticket cannot sit indefinitely on an approval that does not exist

A `change` ticket in `proposed`, and any ticket in `in_review` that does not carry `auto_merge`,
SHALL always have an open decision it is waiting on. Whatever the cause of a gap — a document write
that closed the decision, a withdrawal, a bug not yet known — the daemon SHALL detect a ticket in one
of these statuses with no matching open decision and raise a fresh one for it, on the same cadence as
its liveness scan, so the ticket is never left silently stranded on an approval nobody can answer.

A freshly raised approval SHALL behave exactly as an original one would: it SHALL start **not looked
at yet**, and when the ticket's project runs under YOLO mode it SHALL be held and granted exactly as
an approval created at the normal point would be — after the weaver's review, not at the moment it is
raised. A `plan_approval` raised this way SHALL be granted once the weaver marks it looked at; a
`merge_approval` raised this way SHALL be picked up by the existing auto-merge sweep, and, under YOLO
or `auto_merge`, answered once its review state and readiness condition allow, the same as a
normally-created one.

#### Scenario: A `proposed` ticket with no open plan approval is repaired

- **WHEN** a `change` ticket is `proposed` and has no open `plan_approval` decision
- **THEN** the daemon raises a fresh `plan_approval` decision for it before the next liveness-scan
  interval has passed twice

#### Scenario: An `in_review` ticket with no open merge approval is repaired

- **WHEN** a ticket is `in_review`, does not carry `auto_merge`, and has no open `merge_approval`
  decision
- **THEN** the daemon raises a fresh `merge_approval` decision for it before the next liveness-scan
  interval has passed twice

#### Scenario: An `auto_merge` ticket in `in_review` is not touched

- **WHEN** a ticket is `in_review` and carries `auto_merge`
- **THEN** the repair scan does not raise a merge approval for it, since none is expected while
  `auto_merge` is set

#### Scenario: A YOLO ticket's repaired plan approval is answered immediately

- **WHEN** the weaver marks a YOLO ticket's repaired plan approval **looked at** with its note
- **THEN** the approval is answered automatically as the system actor and the ticket proceeds to
  `approved`, without waiting for a human

#### Scenario: A YOLO ticket's repaired plan approval waits for review

- **WHEN** the repair scan raises a plan approval for a ticket whose project runs under YOLO mode
- **THEN** the approval is open and **not looked at yet**, and the ticket does not proceed to
  `approved` until the weaver marks the approval looked at

#### Scenario: A YOLO ticket's repaired merge approval waits for review and readiness

- **WHEN** the repair scan raises a merge approval for a ticket whose project runs under YOLO mode
- **THEN** the approval is picked up by the auto-merge sweep, and is granted only once the weaver has
  marked it looked at and the project's readiness condition for landing is met
