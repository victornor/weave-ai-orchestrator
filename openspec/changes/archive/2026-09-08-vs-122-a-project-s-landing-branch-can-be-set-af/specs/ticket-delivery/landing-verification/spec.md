## ADDED Requirements

### Requirement: A project's landing branch can be changed or cleared after creation

A project's landing branch SHALL be settable, changeable and clearable at any time after the project
was added, not only when it was created. Setting it to a branch that does not exist on the project's
remote SHALL be rejected at the point of setting, with an error naming the branch, rather than accepted
and discovered later when a ticket's merge fails to verify. Clearing it SHALL restore the behaviour of
a project that has never declared one: every check that verifies where a ticket's work has landed runs
against the project's default branch again. A change to a project's landing branch SHALL take effect
for the next ticket action that resolves it, without requiring the daemon to restart.

#### Scenario: Setting a landing branch after creation

- **WHEN** a project that declared no landing branch at creation has one set afterward, to a branch
  that exists on its remote
- **THEN** the project's landing branch is that branch, and every check that verifies where a ticket's
  work has landed runs against it from the next ticket action onward

#### Scenario: Changing an already-declared landing branch

- **WHEN** a project's landing branch is changed from one existing branch to another
- **THEN** the project's landing branch is the new branch, and no check made after the change runs
  against the old one

#### Scenario: Clearing a project's landing branch

- **WHEN** a project's landing branch is cleared
- **THEN** the project has no declared landing branch, and every check that verifies where a ticket's
  work has landed runs against the project's default branch, exactly as for a project that never
  declared one

#### Scenario: Setting a landing branch that does not exist on the remote is rejected

- **WHEN** a project's landing branch is set to a branch absent from the project's remote
- **THEN** the request is rejected with a validation error naming the branch, and the project's landing
  branch is unchanged

#### Scenario: A changed landing branch needs no restart to take effect

- **WHEN** a project's landing branch is changed while the daemon is running
- **THEN** the next ticket action that resolves that project's landing branch uses the new value,
  without the daemon having been restarted
