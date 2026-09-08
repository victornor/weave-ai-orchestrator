## MODIFIED Requirements

### Requirement: One credential per runtime per host

For each coding-CLI runtime, a host SHALL hold exactly one live credential file: the one the
machine owner's own CLI reads and writes. Every agent turn, and every probe the system makes of that
runtime, SHALL read and write that same file rather than a copy of it.

The system SHALL NOT keep a second live copy of a credential that the runtime may rotate. A
credential that rotates on refresh SHALL therefore be rotated for every reader at once, whichever
side refreshed it: an agent's turn, the system's own account probe, or the owner's interactive
session.

The rest of a runtime's configuration — its settings, its session history and its project state —
SHALL remain isolated per workspace as before. Only the credential is shared.

This requirement governs a daemon that is not isolated. A daemon started isolated, per
`daemon-isolation/credential-scope`, is the documented exception: it does not resolve a runtime's
credential to the host's file at all, unless it was explicitly told to share it.

#### Scenario: An agent turn reads the owner's credential

- **WHEN** an agent takes a turn on a runtime whose host credential exists
- **THEN** the turn reads that host credential, not a copy of it

#### Scenario: A refresh on one side is a refresh for both

- **WHEN** the credential is refreshed during an agent's turn, and the owner's own CLI is then used
- **THEN** the owner's CLI sees the refreshed credential and is not signed out

#### Scenario: A refresh by the owner is a refresh for the agents

- **WHEN** the owner's own CLI refreshes the credential, and an agent then takes a turn
- **THEN** that turn uses the refreshed credential and does not fail to authenticate

#### Scenario: Settings stay per workspace

- **WHEN** a workspace's runtime configuration holds settings or session state alongside the
  credential
- **THEN** those remain the workspace's own and are not shared with the host

#### Scenario: No host credential

- **WHEN** a runtime has no credential on the host at all
- **THEN** the system creates none, and a turn on that runtime fails as an authentication failure
  rather than silently running unauthenticated

#### Scenario: An isolated daemon is the documented exception

- **WHEN** a daemon is isolated per `daemon-isolation/credential-scope`
- **THEN** this requirement does not apply to it, and it does not share the host's credential unless
  explicitly told to
