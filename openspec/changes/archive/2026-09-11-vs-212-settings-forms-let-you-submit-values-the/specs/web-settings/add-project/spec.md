## Purpose

Extends the add-project form's contract to its Max workers input: the bounds the shared project
schema defines for `maxWorkers` are enforced at the field before the operator can submit.

## ADDED Requirements

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
