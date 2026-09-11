## MODIFIED Requirements

### Requirement: No other decision is auto-approved

The mode SHALL apply to plan approvals and merge approvals only. Hire approvals, worktree discard
approvals, worker retry approvals, operational action approvals, gate findings and questions put to
the human SHALL keep their owners and SHALL still wait to be answered, whatever the mode is set to.

#### Scenario: A hire, a discard or a retry

- **WHEN** a hire approval, a discard approval or a retry approval is raised while the mode is on
- **THEN** it waits for the human and is not granted by the daemon

#### Scenario: A question

- **WHEN** an agent asks the human a question while the mode is on
- **THEN** the question waits for an answer and is not answered by the daemon

#### Scenario: An action approval

- **WHEN** an `action_approval` is raised on an `operational` ticket while the mode is on
- **THEN** it waits for the human and is not granted by the daemon
