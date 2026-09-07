# runtime-credentials/credential-visibility Specification

## Purpose
Defines what a human can see about a runtime's credential — whether it is present and valid, when it
expires, when it was last verified and when a refresh last failed — on the usage surfaces and in the
diagnostic command, and the absolute rule that none of those surfaces ever exposes the token.

## Requirements

### Requirement: The system knows and records each runtime's credential state

For each runtime a workspace uses, the system SHALL keep a credential state made of: whether a
credential is present, the moment it expires when the credential says so, the moment it was last
verified as working, the moment a refresh last failed when one has, and whether a login is currently
needed.

Determining that state SHALL NOT require starting the runtime's CLI: the parts that can be read from
the credential itself SHALL be read from it directly. A runtime whose credential the system cannot
interpret SHALL report the credential as present with an unknown expiry, never as absent and never
with a guessed expiry.

The state SHALL be updated when a turn or a probe succeeds, and when one fails to authenticate.

#### Scenario: A valid credential

- **WHEN** a runtime's credential is present and carries an expiry
- **THEN** the recorded state is present, with that expiry, and no login needed

#### Scenario: Reading the state starts nothing

- **WHEN** the credential state is determined
- **THEN** the runtime's CLI is not started in order to determine it

#### Scenario: An uninterpretable credential

- **WHEN** a runtime's credential is present but its expiry cannot be read
- **THEN** the state is present with an unknown expiry, and is not reported as missing

#### Scenario: A failure is recorded

- **WHEN** a turn on a runtime fails to authenticate
- **THEN** the state records the moment the refresh failed and that a login is needed

#### Scenario: A success is recorded

- **WHEN** a turn or a probe on a runtime succeeds
- **THEN** the state records the moment it was last verified and that no login is needed

### Requirement: The usage surfaces and the diagnostic command show the credential's state

The usage view SHALL show, for each runtime it lists, whether that runtime's credential is valid,
when it expires when that is known, and when a refresh last failed when one has. When a login is
needed it SHALL say so and SHALL say what the human must do.

The diagnostic command SHALL report the same state as one of its checks, and SHALL fail that check
when a login is needed, naming the command the human should run.

#### Scenario: The usage view shows a valid credential

- **WHEN** the usage view lists a runtime whose credential is valid and carries an expiry
- **THEN** it shows the credential as valid and shows when it expires

#### Scenario: The usage view shows an expired login

- **WHEN** the usage view lists a runtime that needs a login
- **THEN** it says so, shows when the refresh failed, and says what the human must do

#### Scenario: The diagnostic command passes

- **WHEN** the diagnostic command runs and every runtime's credential is valid
- **THEN** its credential check passes and names each runtime's expiry where known

#### Scenario: The diagnostic command fails on an expired login

- **WHEN** the diagnostic command runs while a runtime needs a login
- **THEN** its credential check fails and names the command that logs that runtime in

### Requirement: No surface exposes the credential

No surface, response, log line, decision, message or diagnostic output SHALL contain a runtime's
access token, refresh token, or any part of either, whether whole, truncated or fingerprinted.

Only the facts about the credential — present, expiring at, last verified at, refresh failed at,
login needed — SHALL leave the system.

#### Scenario: The token is never returned

- **WHEN** any surface reports a runtime's credential state
- **THEN** the report contains no token and no fragment of one

#### Scenario: The token is never logged

- **WHEN** the system records a credential-related event, including a failure to authenticate
- **THEN** what it records contains no token and no fragment of one
