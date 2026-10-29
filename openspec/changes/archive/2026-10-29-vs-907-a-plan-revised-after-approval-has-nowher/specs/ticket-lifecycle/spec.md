## ADDED Requirements

### Requirement: A plan revised after approval is re-approved
When a worker's turn ends on a `change` ticket in `approved` and its plan differs from the stored `plan` document, the daemon SHALL publish the new plan as a new document revision, move the ticket to `proposed`, and raise a fresh `plan_approval` decision targeting that revision. The card context SHALL state that the plan was revised after approval and name the previously approved and the new revision. An unchanged plan, or one that fails validation, SHALL publish nothing and leave the ticket `approved`.

#### Scenario: Revised plan after approval
- **WHEN** a ticket is `approved` on plan revision 1 and the worker's turn ends with a changed, valid plan
- **THEN** the plan is stored as revision 2, the ticket is `proposed`, and an open `plan_approval` targets revision 2 and mentions revisions 1 and 2

#### Scenario: Re-approval resumes the work
- **WHEN** the fresh card is answered `approve`
- **THEN** the ticket becomes `approved` and the worker is woken as for a first approval

#### Scenario: Invalid or unchanged plan
- **WHEN** the plan is unchanged or fails strict validation
- **THEN** no revision is written and the ticket stays `approved`

### Requirement: Task completion state is not a plan revision
The republish comparison SHALL ignore the checked/unchecked state of task checkboxes and compare every other character of the plan. Adding, removing, rewording or reordering a task SHALL count as a revision. This applies to `proposed` and `approved` alike.

#### Scenario: Ticking every box
- **WHEN** a ticket is `approved` (or `proposed`) and the worker's turn ends with only `- [ ]` changed to `- [x]` in `tasks.md`
- **THEN** nothing is republished, no revision is written, no card is raised and the status is unchanged

#### Scenario: Reworded task
- **WHEN** a task's text is changed, with or without its box ticked
- **THEN** the plan is republished as a revision

### Requirement: A worker cannot un-approve its own ticket
The `approved → proposed` move SHALL be performed only by the daemon's republish. A ticket transition requested for it, by any actor, SHALL be refused with the allowed set.

#### Scenario: Worker requests proposed from approved
- **WHEN** a worker calls transition to `proposed` or `proposing` on an `approved` ticket
- **THEN** the request is refused with `invalid_disposition`
