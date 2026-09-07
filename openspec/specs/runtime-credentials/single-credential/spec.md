# runtime-credentials/single-credential Specification

## Purpose
Defines how the agents in a workspace obtain a coding CLI's credentials: that there is exactly one
credential file per runtime per host, shared with the machine owner's own CLI rather than copied, so
that a rotating OAuth token can never exist in two live copies that invalidate each other.

## Requirements

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

### Requirement: A repair of the shared credential is monotonic in the credential's own expiry

A runtime's CLI may replace the shared credential with a file of its own rather than writing through
to it. When the system finds that the workspace's credential path and the host's have become two
distinct files, it SHALL reconcile them back to one.

Reconciliation SHALL choose between the two by the expiry the credentials themselves carry, keeping
the one that expires later. It SHALL NOT choose by file modification time. It SHALL NOT replace a
credential that expires later with one that expires earlier, under any circumstance, including a
failure to authenticate.

When neither credential's expiry can be read, the system SHALL keep the host's and SHALL NOT
overwrite it.

Reconciliation SHALL leave exactly one live credential behind, and SHALL be safe to run repeatedly.

#### Scenario: The CLI replaced the shared credential with its own

- **WHEN** a turn leaves the workspace's credential path as a separate file that expires later than
  the host's
- **THEN** the host's credential is updated to that newer one
- **AND** the workspace's path is once again the same single credential as the host's

#### Scenario: An older credential never wins

- **WHEN** the workspace's credential path holds a separate credential that expires earlier than the
  host's
- **THEN** the host's credential is left untouched
- **AND** the workspace's path is restored to the host's credential

#### Scenario: Modification time does not decide

- **WHEN** two credentials are reconciled and the one that expires earlier was written most recently
- **THEN** the one that expires later is still the one that is kept

#### Scenario: An unreadable expiry is not a reason to overwrite

- **WHEN** a credential's expiry cannot be read from its contents
- **THEN** the host's credential is kept and is not overwritten

#### Scenario: Repairing twice changes nothing

- **WHEN** reconciliation runs a second time with nothing having changed in between
- **THEN** the credential is unchanged and still shared

### Requirement: An authentication failure never rewrites the credential

When a turn fails to authenticate, the system SHALL NOT copy, restore or otherwise rewrite the
runtime's credential in response. A failure to authenticate is a fact about the one credential that
exists; there is no other copy to fall back to, and writing one over it risks destroying a
credential the owner has since renewed.

#### Scenario: A failed turn leaves the credential alone

- **WHEN** an agent's turn fails with an authentication failure
- **THEN** the runtime's credential file is not written to

#### Scenario: A renewed login survives a failure that arrives late

- **WHEN** the owner logs in again while a turn that had already failed to authenticate is being
  finalised
- **THEN** the renewed credential is still in place afterwards

### Requirement: An existing workspace credential is adopted once, not discarded

A workspace upgraded from keeping its own copy of a runtime's credential SHALL be moved to the
shared credential without losing a working login. The system SHALL reconcile the workspace's
existing credential with the host's by the same expiry rule, and SHALL then share whichever it kept.

The system SHALL do this without human action, and SHALL NOT require the owner to log in again when
either side already holds a valid credential.

#### Scenario: The workspace held the newer credential

- **WHEN** a workspace that kept its own copy of a credential is upgraded, and that copy expires
  later than the host's
- **THEN** the host's credential becomes that copy, and both are the one shared credential
  afterwards

#### Scenario: The host held the newer credential

- **WHEN** a workspace that kept its own copy of a credential is upgraded, and the host's expires
  later
- **THEN** the host's credential is kept and the workspace shares it

#### Scenario: No login is demanded by the upgrade

- **WHEN** a workspace with a valid credential on either side is upgraded
- **THEN** no login is required of the owner and the agents keep working
