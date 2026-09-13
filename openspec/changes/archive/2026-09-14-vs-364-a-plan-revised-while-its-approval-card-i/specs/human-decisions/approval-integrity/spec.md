## ADDED Requirements

### Requirement: A plan changed while the ticket is `proposed` is republished at the end of the worker's turn

When a worker's run ends on a `change` ticket whose status is still `proposed` and which carries an
OpenSpec change, the daemon SHALL re-render the plan from the worker's worktree and compare it with the
ticket's current `plan` document body.

If the rendered plan differs from the current document and OpenSpec strict validation passes —
including the capability-retirement check the `proposed` gate already applies — the daemon SHALL
publish a new `plan` document revision and raise a fresh `plan_approval` for the ticket through the
same publication path the `proposing → proposed` transition uses. The previously open `plan_approval`
SHALL be superseded and the fresh one SHALL start with no review mark. The daemon SHALL record an
activity event for the republish and post a ticket status comment stating that the revised plan was
published. The fresh card SHALL wake the weaver for review at creation, exactly as a newly created
review-carrying decision does.

If the rendered plan is identical to the current document, the daemon SHALL publish nothing: no new
revision, no fresh card, no republish comment, and no wake through this path.

If planning is incomplete or validation fails, the daemon SHALL publish nothing and SHALL NOT raise a
fresh card. It SHALL post a ticket comment naming the validation issues and SHALL wake the weaver.

This path SHALL run only for a ticket that is still `proposed`. A ticket in any other status —
`approved`, `in_progress`, `in_review`, `merging`, `blocked`, `done` or `cancelled` — SHALL never be
republished by it.

This republish SHALL NOT change who owns a plan approval or how a held approval is overridden, and
SHALL NOT alter `merge_approval` or `action_approval` behavior.

#### Scenario: A revised plan reaches the card without a transition

- **WHEN** a `change` ticket is `proposed` with an open `plan_approval` at plan revision 1, its worker
  revises the OpenSpec artifacts, and the worker's run ends without the ticket changing status
- **THEN** the ticket's `plan` document is at revision 2
- **AND** the prior `plan_approval` is superseded
- **AND** a fresh `plan_approval` is open and targets revision 2
- **AND** the weaver is woken for review of the fresh card
- **AND** a ticket status comment states the revised plan was published

#### Scenario: An unchanged plan publishes nothing

- **WHEN** a worker's run ends on a `proposed` ticket whose OpenSpec artifacts render to the same plan
  as the current `plan` document
- **THEN** no new `plan` revision is created
- **AND** no fresh `plan_approval` is raised
- **AND** no republish comment is posted

#### Scenario: An invalid revision publishes nothing and names the issues

- **WHEN** a worker's run ends on a `proposed` ticket whose revised OpenSpec artifacts fail strict
  validation
- **THEN** no new `plan` revision is created and no fresh `plan_approval` is raised
- **AND** a ticket comment names the validation issues
- **AND** the weaver is woken

#### Scenario: A ticket that is not `proposed` is never republished

- **WHEN** a worker's run ends on a `change` ticket whose status is not `proposed`, even if its
  OpenSpec artifacts changed during the turn
- **THEN** the republish path creates no `plan` revision and raises no `plan_approval`
