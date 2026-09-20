## ADDED Requirements

### Requirement: The Projects row offers the visual plan artifact control

The Settings Projects section SHALL offer, for each project, a control for the
`policies.visualPlanArtifact` policy: a boolean offering on and off (and no inherit option, because
the policy has no workspace default), shown alongside the project's other policies without being
hidden behind an expander. The control's label SHALL name what it does ("Visual plan artifact"), it
SHALL be marked **experimental**, and it SHALL carry a one-line explanation that turning it on makes
every `change` plan come with a visual artifact on its approval card and that this spends worker
tokens on every plan. Changing it SHALL be sent to `PATCH /api/w/:ws/projects/:id` as
`policies.visualPlanArtifact`, and a subsequent read of the project SHALL reflect the change. An
unset policy SHALL read as off, and rendering the control or opening the section SHALL NOT send a
request that materialises it.

#### Scenario: Turning it on persists it

- **WHEN** the operator turns a project's Visual plan artifact control on
- **THEN** the request carries `policies.visualPlanArtifact: true` and the project read back has it true

#### Scenario: An unset policy reads off

- **WHEN** a project has no `visualPlanArtifact` policy set
- **THEN** its control reads off (not inherited), and no request is sent by rendering it

#### Scenario: The control states its cost and is experimental

- **WHEN** the operator reads the Visual plan artifact control
- **THEN** it is marked experimental and its explanation says the artifact is added to every plan approval card and costs worker tokens on every plan

### Requirement: The add-project form offers the visual plan artifact choice

The Settings add-project form SHALL offer the visual plan artifact choice and send it on `POST
/projects` as `policies.visualPlanArtifact`, without breaking the existing strict-body contract. A
project added with the choice untouched SHALL have the policy off; one added with it on SHALL have it
on.

#### Scenario: Adding with it on

- **WHEN** the operator submits the add-project form with the Visual plan artifact choice on
- **THEN** `POST /projects` accepts the request and the created project's `policies.visualPlanArtifact` is true

#### Scenario: The default is off when untouched

- **WHEN** the operator submits the add-project form without changing the visual plan artifact choice
- **THEN** the created project's `policies.visualPlanArtifact` is off
