## MODIFIED Requirements

### Requirement: The usage surfaces and the diagnostic command show the credential's state

The usage view SHALL show, for each runtime it lists, whether that runtime's credential is healthy or
needs the human. A healthy credential SHALL be shown as healthy; when a last-verified moment is known
it SHALL be shown as evidence that it is working, not as a deadline. The usage view SHALL NOT show a
countdown to a credential's expiry unless that expiry is a genuine deadline a human could act on — an
access token's self-refreshing expiry is not one, and no runtime's `expiresAt` known to the system
today is anything else, so none is shown as a countdown. When a login is needed the usage view SHALL
say so, SHALL show when the refresh failed, and SHALL say what the human must do.

The diagnostic command SHALL report the same underlying state as one of its checks, and SHALL fail
that check when a login is needed, naming the command the human should run.

#### Scenario: The usage view shows a valid credential

- **WHEN** the usage view lists a runtime whose credential is present and no login is needed
- **THEN** it shows the credential as healthy and shows no countdown to its expiry; when a
  last-verified moment is known it shows that instead

#### Scenario: A healthy credential with no last-verified moment

- **WHEN** the usage view lists a runtime whose credential is present, no login is needed, and no
  last-verified moment is recorded yet
- **THEN** it shows the credential as healthy and shows neither a countdown nor a last-verified line

#### Scenario: The usage view shows an expired login

- **WHEN** the usage view lists a runtime that needs a login
- **THEN** it says so, shows when the refresh failed, and says what the human must do

#### Scenario: The diagnostic command passes

- **WHEN** the diagnostic command runs and every runtime's credential is valid
- **THEN** its credential check passes and names each runtime's expiry where known

#### Scenario: The diagnostic command fails on an expired login

- **WHEN** the diagnostic command runs while a runtime needs a login
- **THEN** its credential check fails and names the command that logs that runtime in
