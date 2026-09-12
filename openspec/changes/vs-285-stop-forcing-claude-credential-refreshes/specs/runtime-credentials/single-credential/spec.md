## MODIFIED Requirements

### Requirement: A repair of the shared credential is monotonic in the credential's own expiry

A runtime's CLI may replace the shared credential with a file of its own rather than writing through
to it. When the system finds that the workspace's credential path and the host's have become two
distinct files, it SHALL reconcile them back to one. Spawning a turn SHALL continue to check for and
repair this, exactly as it does today.

The system SHALL NOT perform this reconciliation as a step of an account or usage probe. Reading a
runtime's billing or plan state SHALL NOT open a runtime's credential file for writing.

Reconciliation SHALL choose between the two by the expiry the credentials themselves carry, keeping
the one that expires later. It SHALL NOT choose by file modification time. It SHALL NOT replace a
credential that expires later with one that expires earlier, under any circumstance, including a
failure to authenticate.

When neither credential's expiry can be read, the system SHALL keep the host's and SHALL NOT
overwrite it.

An intact, unforked credential SHALL be left untouched by this check: reconciliation SHALL NOT open
either credential path for writing when the workspace's path is already the single shared credential.

Reconciliation SHALL leave exactly one live credential behind, and SHALL be safe to run repeatedly.

#### Scenario: The CLI replaced the shared credential with its own

- **WHEN** the system reconciles a workspace's runtime config home, and that workspace's credential
  path is a separate file that expires later than the host's
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

#### Scenario: Spawning a turn still repairs a real fork

- **WHEN** an agent's turn is spawned and the workspace's credential path has diverged from the
  host's into a separate, newer-expiring file
- **THEN** the host's credential is updated to that newer one before the turn proceeds, exactly as it
  is today

#### Scenario: Spawning a turn against an intact credential writes nothing

- **WHEN** an agent's turn is spawned and the workspace's credential path is already the single
  shared credential
- **THEN** nothing about spawning that turn opens either credential path for writing

#### Scenario: Probing an account never reconciles

- **WHEN** the system probes a runtime's account for billing or plan reporting
- **THEN** nothing about that probe opens either credential path for writing
