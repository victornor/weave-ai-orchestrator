## Purpose

Defines the check that stops a change from being proposed when its OpenSpec deltas would empty a
capability's spec without the change declaring that it means to retire that capability, so the gap
is caught while a worker can still fix it rather than after the PR that carries it has merged.

## ADDED Requirements

### Requirement: An undeclared capability retirement fails the proposed gate

When a `change` ticket requests the `proposed` transition, if any of the change's spec deltas would
leave a capability with zero requirements once merged into its current main spec, and the change's
`.openspec.yaml` does not set `retire_capabilities: true`, the system SHALL reject the transition
with an error that names the emptied capability and the `retire_capabilities` marker, even when
`openspec validate --strict` itself reports no issues.

#### Scenario: A delta removes every requirement a capability has

- **WHEN** a change's spec delta for a capability consists only of a `## REMOVED Requirements`
  section naming every requirement that capability's current main spec has, and the change's
  `.openspec.yaml` does not set `retire_capabilities: true`
- **THEN** requesting `proposed` for the ticket is rejected
- **AND** the rejection names the capability and states that `retire_capabilities: true` must be set
  in the change's `.openspec.yaml` to retire it

#### Scenario: The same delta with retirement declared passes

- **WHEN** a change's spec delta would leave a capability with zero requirements, and the change's
  `.openspec.yaml` sets `retire_capabilities: true`
- **THEN** the check does not reject the transition on that capability's account

#### Scenario: A delta that leaves at least one requirement is unaffected

- **WHEN** a change's spec delta for a capability removes some but not all of its current
  requirements, or adds or modifies requirements so at least one remains, regardless of whether
  `retire_capabilities` is set
- **THEN** the check does not reject the transition on that capability's account

#### Scenario: A brand-new capability is unaffected

- **WHEN** a change's spec delta introduces a capability that has no existing main spec (an `ADDED`
  delta with no prior `openspec/specs/<capability-path>/spec.md`)
- **THEN** the check does not reject the transition on that capability's account, because there is no
  existing capability to have emptied
