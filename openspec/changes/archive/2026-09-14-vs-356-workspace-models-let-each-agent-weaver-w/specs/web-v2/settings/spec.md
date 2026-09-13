## MODIFIED Requirements

### Requirement: A workspace override shows its difference and resets to the daemon value

The workspace Models section SHALL mark each control — the weaver setting, the workers setting and
the worker-options catalog — as `inherited` or `overridden` from the per-control source the API
reports, not by comparing the effective value to the daemon's value. An overridden control SHALL
carry an accent border and an `overridden` tag; an inherited control SHALL use recessed styling and
an `inherited` tag.

Each control SHALL offer Override and, when overridden, Reset to daemon. Overriding an agent SHALL
write only that agent's control, so the other agent is not pinned. Overriding the worker-options
catalog SHALL materialize the daemon's catalog into the workspace so it can be edited. Reset to
daemon SHALL clear just that control — for an agent by writing `null`, for the catalog by writing
`null` — so it inherits again rather than pinning the daemon's current value.

For an overridden control a footer SHALL name the actual difference against the daemon's value (for
example "Overrides thinking high → max."); for an inherited control the footer SHALL state that the
value is inherited. A banner SHALL count what is overridden, derived from the same source map the
tags use, never from a separate comparison. The worker-option catalog SHALL be inherited or
overridden as a whole; while it is inherited it SHALL show the daemon's list, and an option's id and
description SHALL remain the daemon's meaning.

#### Scenario: An inherited agent

- **WHEN** the API reports the workspace's `weaver` control as `daemon` or `default`
- **THEN** the agent card shows the `inherited` tag, recessed controls and a footer saying it is
  inherited from the daemon

#### Scenario: An overridden agent

- **WHEN** the API reports an agent control as `workspace`
- **THEN** the card shows the `overridden` tag, an accent border, and a footer naming the differing
  fields and their values

#### Scenario: Overriding one agent does not pin the other

- **WHEN** the user changes the weaver setting while the workers setting is inherited
- **THEN** the write names only the weaver control, and the workers control still reads inherited

#### Scenario: Reset to daemon

- **WHEN** the user resets an overridden agent
- **THEN** a write clearing only that agent's control is made and the card reads as inherited again

#### Scenario: The banner count agrees

- **WHEN** the overrides banner shows a count
- **THEN** it is the number of controls the same source map marks overridden on the screen, never a
  separate literal

#### Scenario: The option list is the daemon's

- **WHEN** the worker-options catalog is inherited
- **THEN** it shows the daemon's options, and each option's id, description and meaning remain the
  daemon's

#### Scenario: The worker-options catalog inherits or overrides as a whole

- **WHEN** the API reports the workspace's `workerOptions` source as `daemon` or `default`
- **THEN** the catalog shows the daemon's options, recessed, marked inherited, and Override seeds the
  workspace's own catalog from the daemon's so its options can be changed

#### Scenario: An empty daemon catalog can still be overridden

- **WHEN** the worker-options catalog is inherited and the daemon has no options
- **THEN** Override opens the catalog editor with an empty list, nothing is written until the first
  option is added, and Cancel returns to the inherited view

#### Scenario: Resetting the catalog clears it

- **WHEN** the user resets an overridden worker-options catalog
- **THEN** a write clearing only the catalog is made and the catalog reads as inherited again,
  showing the daemon's list
