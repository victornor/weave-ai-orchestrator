## ADDED Requirements

### Requirement: The rail's Live badge and the floor's figure are one derivation

The number the rail shows beside Live SHALL be computed from the same working set and the same
derivation as the Live floor's roster figure, so the badge and the floor it points to cannot
disagree by construction. The badge SHALL count the same working set the floor labels running —
including a worker held in the between-turns handover grace — and SHALL reach that figure from the
worker events the document receives, without the Live page being opened.

#### Scenario: The badge equals the floor's roster figure

- **WHEN** the Live floor is scoped Everywhere and renders its roster figure
- **THEN** the rail's Live badge equals the number of floor cards that read working

#### Scenario: Two workspaces

- **WHEN** a worker is working in workspace Alpha and another in workspace Beta
- **THEN** the rail's Everywhere Live badge and the floor's roster figure both count two, and each workspace's own rail row counts only its own worker

#### Scenario: A worker inside the handover grace

- **WHEN** a worker's turn just ended and it is still held in the working group
- **THEN** the rail's Live badge and the floor's roster figure both count it, and both drop it once the grace elapses

#### Scenario: A worker in another workspace lifts the badge

- **WHEN** a worker starts in a workspace other than the one the app is showing
- **THEN** the rail's Live badge rises without the Live page being opened