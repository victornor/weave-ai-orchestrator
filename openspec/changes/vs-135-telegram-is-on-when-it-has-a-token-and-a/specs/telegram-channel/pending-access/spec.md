## Purpose

Lets captain grant a stranger who messaged the Telegram bot access by recognising their identity in
Settings and approving them, without ever having to learn or type their numeric Telegram user id.

## ADDED Requirements

### Requirement: An unrecognised sender is recorded by identity, never by message content

When a Telegram user who is not on the allowlist (and the workspace is not marked open to all)
sends a message, the channel SHALL record their Telegram user id, username (if any), display name
(if any), the time of their first and most recent attempt, and how many attempts they have made.
The text of their message SHALL NOT be recorded, displayed, or passed anywhere the message content
of an allowed sender would go.

#### Scenario: A stranger's first message is recorded

- **WHEN** a Telegram user not on the allowlist sends a message for the first time
- **THEN** their user id, username, display name, first-attempt time and an attempt count of one are
  recorded, and their message text is not recorded anywhere

#### Scenario: A repeated stranger updates the same record

- **WHEN** a Telegram user already recorded as pending sends another message
- **THEN** their existing record's last-attempt time and attempt count are updated rather than a
  second record being created, and the new message's text is not recorded

### Requirement: Nothing from an unapproved sender reaches the conductor

A message from a sender who is not on the allowlist SHALL NOT be delivered to the conductor, SHALL
NOT be stored as a thread message, and SHALL NOT trigger a run. Recording that the attempt happened
is not delivering it.

#### Scenario: A stranger's message triggers nothing

- **WHEN** a Telegram user not on the allowlist sends a message
- **THEN** no thread message is created for it, no run is triggered by it, and the conductor is not
  woken by it

### Requirement: The pending list is capped and expires

The workspace SHALL retain no more than 50 pending identities at a time; once at the cap, a message
from a Telegram user not already recorded SHALL be dropped without creating a new record, so that a
flood of distinct strangers cannot displace identities already waiting for review. A pending
identity's record SHALL be removed once 7 days have passed since its most recent attempt.

#### Scenario: The cap protects existing pending identities

- **WHEN** the workspace already has 50 pending identities recorded and a message arrives from a
  51st, previously unrecorded, Telegram user
- **THEN** no new record is created for the 51st user, and the existing 50 records are unchanged

#### Scenario: An old pending identity expires

- **WHEN** a pending identity's most recent attempt was more than 7 days ago
- **THEN** it is no longer present in the pending list

### Requirement: Settings lists pending identities with an approve action

Settings SHALL show every currently pending identity with what is needed to recognise them (id,
username, display name, first and last attempt, attempt count) and an action that adds that
identity's Telegram user id to the allowlist. Approving SHALL state, at the point of the action,
that the approved person will be able to direct work in this workspace through the conductor.

#### Scenario: A pending identity appears in Settings

- **WHEN** captain opens the Telegram section of Settings and at least one identity is pending
- **THEN** each pending identity is shown with its id, username, display name, first and last
  attempt time and attempt count, and an approve action

#### Scenario: Approving grants access

- **WHEN** captain approves a pending identity
- **THEN** that identity's Telegram user id is added to the allowlist, it is removed from the
  pending list, and a subsequent message from that user is delivered to the conductor

### Requirement: Access granted by approval is revocable

Removing a Telegram user id from the allowlist, whether it was added by approving a pending identity
or entered directly, SHALL revoke that user's access on the running channel.

#### Scenario: Revoking an approved user's access

- **WHEN** captain removes a previously approved user's id from the allowlist
- **THEN** a subsequent message from that user is rejected, and it is recorded as a new pending
  identity rather than delivered
