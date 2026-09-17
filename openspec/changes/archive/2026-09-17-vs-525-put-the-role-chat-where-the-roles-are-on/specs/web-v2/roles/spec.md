## ADDED Requirements

### Requirement: The role's session control names starting or resuming

The V2 Roles screen's per-role control that opens the role's persistent session SHALL state whether it will open an existing conversation or start a new one, using the same wording the project overview's role list uses. A role that cannot serve a persistent session (its status is not `active`) SHALL NOT offer the control and SHALL state the reason. The control SHALL call the same open-or-resume operation the project overview uses.

#### Scenario: An existing session reads differently from a new one

- **WHEN** a role already has a persistent session, or does not
- **THEN** the control offers to open the conversation in the first case and to start one in the second

#### Scenario: A paused role offers no chat control

- **WHEN** a role is paused or retired
- **THEN** its row offers no session control and states the reason

#### Scenario: The same operation serves both surfaces

- **WHEN** the control is used from the Roles screen
- **THEN** it opens that role's persistent session through the same operation the project overview's list uses
