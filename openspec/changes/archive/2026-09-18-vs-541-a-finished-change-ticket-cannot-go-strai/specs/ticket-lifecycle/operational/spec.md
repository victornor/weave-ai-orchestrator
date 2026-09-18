## MODIFIED Requirements

### Requirement: The operational lifecycle has no propose, review or merge

An `operational` ticket SHALL move `todo → done`, optionally through `in_progress` (and the same `blocked` / `cancelled` / reopen edges a `scout` already has). Transitions to `proposing`, `proposed`, `approved`, `in_review` or `merging` SHALL be rejected as graph-invalid. Reaching `done` SHALL NOT raise a `merge_approval` and SHALL NOT require a work product.

#### Scenario: the happy path

- **WHEN** an `operational` ticket in `todo` is transitioned to `in_progress` and later to `done`
- **THEN** both transitions succeed and no `merge_approval` is raised

#### Scenario: finishing without an action

- **WHEN** an `operational` ticket in `todo` whose branch carries no commits missing from its landing branch is transitioned to `done`
- **THEN** the transition succeeds, no `merge_approval` is raised, and no work product is required

#### Scenario: propose and review statuses are unreachable

- **WHEN** an `operational` ticket is transitioned to `proposing`, `proposed`, `in_review` or `merging`
- **THEN** the transition is rejected with error code `invalid_disposition`
- **AND** the allowed list does not include those statuses
