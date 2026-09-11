# web-settings/add-project Specification

## Purpose
Defines how the Settings add-project form talks to `POST /projects`: that its Auto-merge default control maps onto the new project's `autoMergeDefault` policy, that adding succeeds with the control on or off, and that the request never sends the ticket-level `autoMerge` key the route does not accept.

## Requirements

### Requirement: Adding a project from Settings succeeds with Auto-merge default on or off

The Settings add-project form SHALL submit a body that `POST /projects` accepts, whether the Auto-merge default control is on or off. The request SHALL NOT include a top-level `autoMerge` field. `POST /projects` SHALL continue to reject a body that does include that field as a validation error naming the unrecognized key.

#### Scenario: Adding with Auto-merge default off

- **WHEN** the operator submits the Settings add-project form with Auto-merge default off
- **THEN** `POST /projects` accepts the request and the new project is created

#### Scenario: Adding with Auto-merge default on

- **WHEN** the operator submits the Settings add-project form with Auto-merge default on
- **THEN** `POST /projects` accepts the request and the new project is created

#### Scenario: A top-level autoMerge key is rejected

- **WHEN** `POST /projects` is called with a top-level `autoMerge` field
- **THEN** the request is rejected as a validation error naming `autoMerge` as unrecognized

### Requirement: Auto-merge default maps to the project's autoMergeDefault policy

The form's Auto-merge default control SHALL set the new project's `policies.autoMergeDefault`, not a ticket-level auto-merge flag. When the control is on, the created project's `policies.autoMergeDefault` SHALL be true. When the control is off, `policies.autoMergeDefault` SHALL be false or unset.

#### Scenario: On stores autoMergeDefault true

- **WHEN** a project is added from Settings with Auto-merge default on
- **THEN** the created project's `policies.autoMergeDefault` is true

#### Scenario: Off does not store autoMergeDefault true

- **WHEN** a project is added from Settings with Auto-merge default off
- **THEN** the created project's `policies.autoMergeDefault` is false or unset, not true

### Requirement: The Max workers input follows the project schema's bounds before submit

The Settings add-project form's Max workers input SHALL show a violation at the field, as the
value is typed and before any submit, when it is not a whole number within the bounds the shared
project schema defines for `maxWorkers`. The action that adds the project SHALL be unavailable
while the value is out of bounds. The input's bounds SHALL come from the shared project schema
rather than restated constants. `POST /projects` SHALL continue to reject an out-of-bounds value
from any caller other than the form.

#### Scenario: An out-of-bounds value is flagged at the field while typing

- **WHEN** the operator types a Max workers value outside the schema's bounds, such as a number
  above the schema's maximum
- **THEN** the field shows the violation before any submit, and the add action is unavailable

#### Scenario: A valid value returns the add action

- **WHEN** the operator corrects the value to a whole number within the schema's bounds
- **THEN** the violation clears and the add action becomes available again, the other required
  fields permitting

#### Scenario: The route still rejects an out-of-bounds value

- **WHEN** `POST /projects` receives a `maxWorkers` outside the schema's bounds from anything
  other than this form
- **THEN** the request is rejected as a validation error, exactly as before this change
