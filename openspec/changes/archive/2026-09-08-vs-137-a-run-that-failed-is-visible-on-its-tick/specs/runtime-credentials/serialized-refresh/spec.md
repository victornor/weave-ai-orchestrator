## MODIFIED Requirements

### Requirement: A refresh that cannot restore a working credential is one authentication failure, not several

When the refresh required by this capability cannot restore a working credential, every agent that
was waiting on it SHALL be treated as though its own turn had failed to authenticate, and SHALL be
handled by the system's existing response to an authentication failure — one gate, one decision, no
retry — rather than by any separate mechanism.

The system SHALL NOT spawn a turn for an agent whose wait resolved this way.

The message recorded for this failure SHALL describe what the refresh itself found: whether the
account could be described at all, and whether the local credential file shows a currently valid
session. It SHALL NOT substitute an account descriptor's own informational note for the reason the
refresh failed when that descriptor reported the account successfully — a note about how an account
is billed is a fact about the account, not a diagnosis of why its credential did not check out, and
presenting one as the other has previously produced a recorded authentication failure that read as a
billing statement.

#### Scenario: A failed shared refresh gates the runtime once

- **WHEN** the one refresh several waiting agents share cannot restore a working credential
- **THEN** the runtime is gated exactly as it would be for a single agent's own authentication
  failure, and no agent that was waiting spawns a turn

#### Scenario: Waiting agents keep their work

- **WHEN** agents are gated because the refresh they were waiting on failed
- **THEN** the wake-ups they were woken for are preserved, unchanged from the system's existing
  authentication-failure behavior

#### Scenario: A billing note is never recorded as the reason a refresh failed

- **WHEN** the account can be described, the description reports how the account is billed with no
  indication of a problem, and the local credential still cannot be confirmed valid
- **THEN** the recorded message says the account was described and what the local credential showed
- **AND** it does not repeat the description's billing note as the reason the refresh failed

#### Scenario: An undescribable account still says so plainly

- **WHEN** the account cannot be described at all — the probe fails, times out, or answers with
  something the system cannot parse
- **THEN** the recorded message says the account could not be described, using whatever detail the
  probe itself reported
