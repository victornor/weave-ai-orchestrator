## ADDED Requirements

### Requirement: There is no separate enabled control

The Telegram channel SHALL be on exactly when a token resolves for it (from the secret store or a
resolved `${ENV_VAR}`) and off exactly when none does. The interface SHALL NOT expose a separate
enabled/disabled control for the channel, and no such control SHALL affect whether the channel runs.

#### Scenario: No enabled toggle exists

- **WHEN** captain opens the Telegram section of Settings
- **THEN** there is no control offering to enable or disable the channel independently of its token

#### Scenario: A token alone turns the channel on

- **WHEN** a token resolves for the workspace, from either source
- **THEN** the Telegram channel runs, regardless of any other setting
