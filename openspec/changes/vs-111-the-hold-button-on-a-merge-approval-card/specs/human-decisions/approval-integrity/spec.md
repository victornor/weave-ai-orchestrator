## ADDED Requirements

### Requirement: A decision card never offers an action its decision does not accept

Every button a decision card offers SHALL send a key that decision's own options actually contain. A
card SHALL NOT be shipped with a hard-coded action whose key is not one of the option keys the daemon
declares when it creates that kind of decision.

A merge-approval card SHALL offer no action to defer answering it; taking the card out of view without
answering is covered entirely by hiding it from the chat, which leaves the decision open and
unanswered for later.

A discard-approval card's action that proceeds with the discard SHALL send the same key
`applyDiscardApproval` treats as approval.

#### Scenario: The merge-approval card offers no Hold action

- **WHEN** a merge-approval card is shown for an open decision
- **THEN** its only actions are approving the merge and requesting changes, and no action sends a key
  other than `approve` or `changes`

#### Scenario: The discard-approval card's discard action is answerable

- **WHEN** the human confirms and sends a discard-approval card's action to proceed
- **THEN** the decision is answered with the key its options declare for proceeding, and the ticket's
  worktree discard is applied exactly as answering that option through any other surface would apply it

#### Scenario: A hard-coded card action is checked against its decision's real options

- **WHEN** a decision kind's card is built with actions whose keys are written into the card rather
  than read from the decision at render time
- **THEN** a test fails if any of those keys is absent from the option keys that kind of decision is
  actually created with
