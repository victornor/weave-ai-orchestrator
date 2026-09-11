## ADDED Requirements

### Requirement: Daemon model overlays offer thinking level next to the model

The daemon Models page SHALL offer the same thinking-level control as the workspace model settings on each conductor and workers overlay row, and on the daemon worker-options add form, constrained to what the chosen model reports. While a row is inheriting, that control SHALL be disabled with the rest of the row and SHALL NOT create an overlay.

#### Scenario: An overriding row can set thinking level

- **WHEN** a daemon Models conductor or workers row is overriding and the chosen model reports a non-empty efforts list
- **THEN** a thinking-level control next to that model offers exactly those values plus unset

#### Scenario: An inheriting row's thinking level is inert

- **WHEN** a daemon Models row is inheriting
- **THEN** opening or changing its thinking-level control does not create an overlay and does not write to the daemon
