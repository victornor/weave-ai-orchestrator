## ADDED Requirements

### Requirement: A project's YOLO mode is a deliberate, confirmed choice

The Projects section SHALL offer, for each project, a control for YOLO mode that reads off for a
project whose `policies.yolo` is not true. Turning it on SHALL require the operator's explicit
confirmation before any request is sent, and the confirmation SHALL state that the daemon will grant
that project's plan and merge approvals itself while action approvals always stay with the human.
Only after the operator confirms SHALL the project be patched to `policies.yolo: true`. Dismissing
the confirmation SHALL send no request. Turning the mode off SHALL send the patch without
confirmation.

A project whose `policies.yolo` is true SHALL show a visible marker in its row while it is on.

#### Scenario: Turning it on asks first

- **WHEN** the operator activates the YOLO control for a project that has it off
- **THEN** a confirmation is shown before any request, and the confirmation states that plan and merge approvals are granted for that project while action approvals always stay with the human

#### Scenario: Only a confirmed change is written

- **WHEN** the operator confirms the YOLO control for a project
- **THEN** the project is patched to `policies.yolo: true`, and the row read back shows the mode on with its marker

#### Scenario: Dismissing writes nothing

- **WHEN** the operator dismisses the confirmation without confirming
- **THEN** no request is sent and the project's policies are unchanged

#### Scenario: Turning it off needs no confirmation

- **WHEN** the operator turns the mode off for a project that has it on
- **THEN** the project is patched off and no confirmation is shown

## MODIFIED Requirements

### Requirement: An unset policy reads as inherited and opening the section writes nothing

A policy the project has not set SHALL read as inherited — following the workspace, or the built-in
default where the workspace sets none — and SHALL NOT be displayed as a concrete project value, with
the exception of YOLO mode, which has no workspace default: an unset `policies.yolo` SHALL read as
off and SHALL NOT be displayed as inherited, and the YOLO control SHALL offer no inherit option.
Rendering the controls, or opening the Projects section, SHALL NOT send any request that
materialises a policy into the project's config. Choosing the inherit option for a policy SHALL
remove that policy's key from the project's stored policies rather than storing a concrete value.

#### Scenario: Opening the section does not write

- **WHEN** the operator opens the Projects section and takes no action
- **THEN** no request that changes a project is sent

#### Scenario: An unset policy reads as inherited

- **WHEN** a project has no `mergeMethod` policy set
- **THEN** its control shows it as inherited rather than as a concrete `squash` value

#### Scenario: An unset YOLO policy reads as off

- **WHEN** a project has no `policies.yolo` set
- **THEN** its YOLO control reads off, not inherited, and offers no inherit option

#### Scenario: Returning a policy to inherit clears the override

- **WHEN** the operator selects the inherit option for a policy the project had set
- **THEN** the request's policies object omits that key, and the project read back has it unset
