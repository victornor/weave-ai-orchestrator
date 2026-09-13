## ADDED Requirements

### Requirement: A revised plan republished at turn end lifts the prior card's concern-hold

When a plan that a worker revised while the ticket was still `proposed` is republished at the end of
that worker's turn, the previously held `plan_approval` SHALL be superseded and the fresh
`plan_approval` SHALL start at **not looked at yet** with no hold of its own. The concern recorded on
the superseded card SHALL NOT carry to the fresh card, and the fresh card SHALL be approvable without
an override once the weaver has marked it. This is the same lift "A held approval lifts when it stops
being the live decision" already gives a re-proposed plan; the only difference is that the ticket
never left `proposed`.

A `concerns` mark SHALL keep holding until such a new revision lands: while the marked card is still
the live question for its ticket, an approving answer without the deliberate override SHALL still be
refused.

#### Scenario: A concern on a superseded plan does not hold the republished one

- **WHEN** an open `plan_approval` is marked **looked at, with concerns**, the worker revises the plan
  while the ticket stays `proposed`, and the daemon republishes the revision at the end of that turn
- **THEN** the marked decision is superseded and no longer answerable
- **AND** the fresh `plan_approval` is open at **not looked at yet**, carrying no concern
- **AND** once the weaver marks the fresh card, the human can approve it without an override

#### Scenario: A concern still holds until a revision lands

- **WHEN** the `plan_approval` currently live for a ticket is marked **looked at, with concerns** and
  no revised plan has been published for that ticket
- **THEN** an approving answer without the deliberate override is still refused
