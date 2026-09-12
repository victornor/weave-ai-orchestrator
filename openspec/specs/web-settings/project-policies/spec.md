# web-settings/project-policies Specification

## Purpose
Defines how an operator reads and changes a project's delivery policies and setup command from the
Settings Projects section, including how an unset policy reads as inherited, how an invalid value is
refused, and that changing one thing touches nothing else on the project.

## Requirements

### Requirement: A project's delivery policies and setup command are editable from the Projects section

The Settings Projects section SHALL let the operator read and change, per project, every field of
`ProjectPoliciesSchema` (`proposalApproval`, `mergeMethod`, `deliveryMode`, `autoMergeDefault`,
`taskApproval`, `archiveCommit`, `requireCi`, `mergeConcurrency`, `yolo`) and `setupCommand`. A
change SHALL be sent to the existing `PATCH /api/w/:ws/projects/:id`, and a subsequent read of the
project SHALL reflect the change.

#### Scenario: Changing a policy persists it

- **WHEN** the operator changes a project's `deliveryMode` to `local-branch`
- **THEN** the request carries `policies.deliveryMode` as `local-branch`, and the project read back afterwards has that value

#### Scenario: Reading a project shows its policies and setup command

- **WHEN** the operator opens the Projects section
- **THEN** each project's current policy values and setup command are shown

#### Scenario: Changing the setup command persists it

- **WHEN** the operator enters a setup command for a project and commits the field
- **THEN** the project read back afterwards has that setup command

### Requirement: An unset policy reads as inherited and opening the section writes nothing

A policy the project has not set SHALL read as inherited — following the workspace, or the built-in
default where the workspace sets none — and SHALL NOT be displayed as a concrete project value.
Rendering the controls, or opening the Projects section, SHALL NOT send any request that materialises
a policy into the project's config. Choosing the inherit option for a policy SHALL remove that
policy's key from the project's stored policies rather than storing a concrete value.

#### Scenario: Opening the section does not write

- **WHEN** the operator opens the Projects section and takes no action
- **THEN** no request that changes a project is sent

#### Scenario: An unset policy reads as inherited

- **WHEN** a project has no `mergeMethod` policy set
- **THEN** its control shows it as inherited rather than as a concrete `squash` value

#### Scenario: Returning a policy to inherit clears the override

- **WHEN** the operator selects the inherit option for a policy the project had set
- **THEN** the request's policies object omits that key, and the project read back has it unset

### Requirement: An invalid policy value is refused with its limit or allowed values before the PATCH

A policy value the shared schema would reject SHALL be refused at the control, before any PATCH is
sent, with the limit or the allowed values visible. An enum or boolean control SHALL offer only the
values the shared schema allows, plus the inherit option. A `mergeConcurrency` outside the schema's
integer bounds SHALL show a violation naming those bounds and SHALL NOT be sent.

#### Scenario: An out-of-range merge concurrency is not sent

- **WHEN** the operator commits a `mergeConcurrency` value outside the schema's bounds
- **THEN** the field shows the allowed range and no PATCH is sent to the daemon

#### Scenario: Enum controls offer only schema values

- **WHEN** the operator opens a policy control for an enumerated policy
- **THEN** its options are exactly the values the shared enum/schema declares, plus the inherit option

### Requirement: Changing one policy leaves the project's other fields untouched

A policy change SHALL be sent as the project's existing policies with only the changed key added or
removed, and SHALL NOT restate or drop the project's other policies, `setupCommand`, `maxWorkers`,
`landingBranch` or any other project field. A setup-command change SHALL likewise carry only
`setupCommand`. Successive changes without an intervening refetch SHALL NOT lose an earlier change.

#### Scenario: A policy change preserves the other policies

- **WHEN** the operator changes one policy on a project that has other policies set
- **THEN** the request's policies object contains every other policy the project had, unchanged, alongside the changed one

#### Scenario: A policy change does not restate other project fields

- **WHEN** the operator changes a policy
- **THEN** the request body contains no `maxWorkers`, `landingBranch`, `setupCommand` or other project field

#### Scenario: Successive policy changes preserve each other

- **WHEN** the operator changes one policy and then another before the project has been refetched
- **THEN** the second request's policies object still carries the first change
