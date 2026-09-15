## ADDED Requirements

### Requirement: A review mark can say what it is waiting on

A review mark on a `plan_approval`, `merge_approval` or `action_approval` SHALL accept, for both
`looked` and `concerns`, an optional short `waitingOn` statement — at most 120 characters — naming
what the weaver is waiting for before the card can be answered. When supplied, the daemon SHALL store
it on the decision and every card that shows the review SHALL render it as a line distinct from the
review outcome and its note. It SHALL NOT change the review state, gate or answer anything, or act as
a concern: a decision marked `looked` with a `waitingOn` is still `looked`.

A later mark on the same decision SHALL replace the whole waiting statement: a mark that supplies none
SHALL clear it, and a mark that supplies one SHALL store the new text. The statement SHALL also clear
when something makes it stale, without any new mark: when the ticket's delivery head moves away from
the head the review was recorded against, and when the card stops being the live question for its
ticket (a new plan revision supersedes it, or it is answered, withdrawn or expired). A fresh decision
raised under a superseded one SHALL carry no waiting statement of its own.

A `waitingOn` longer than 120 characters SHALL be refused with a validation error and SHALL leave the
decision unchanged. A statement on a decision kind that does not carry review SHALL be refused exactly
as a review mark on that kind is.

#### Scenario: A looked mark says it is waiting for CI

- **WHEN** the weaver marks an open `merge_approval` **looked** with a note and a `waitingOn` naming the runner CI on a commit
- **THEN** the decision is **looked**, the note is stored, and the `waitingOn` statement is stored with it

#### Scenario: A concern mark carries its waiting statement

- **WHEN** the weaver marks an open `merge_approval` **looked at, with concerns** with a concern summary and a `waitingOn`
- **THEN** both the concern and the waiting statement are stored on the decision

#### Scenario: A later mark without a waiting statement clears it

- **WHEN** a decision carries a `waitingOn` and the weaver marks it again without one
- **THEN** the decision carries no waiting statement afterwards, and the new mark's state and note are stored

#### Scenario: An over-long waiting statement is refused

- **WHEN** a review mark supplies a `waitingOn` longer than 120 characters
- **THEN** the write is refused with a validation error and the decision's review fields are unchanged

#### Scenario: A head move clears the waiting statement

- **WHEN** an open `merge_approval` carries a `waitingOn` recorded against head `sha1`, and the ticket's delivery head is later observed at `sha2`
- **THEN** the decision's waiting statement is cleared, without altering its review state or its note

#### Scenario: Supersession clears the waiting statement with the card

- **WHEN** a decision carrying a `waitingOn` is superseded by a fresh decision of the same kind for the same ticket
- **THEN** the fresh decision carries no waiting statement
