# runtime-credentials/serialized-refresh Specification

## Purpose
Defines how the system stops a burst of simultaneous agent spawns from causing a burst of
independent credential refreshes: at most one refresh is ever in flight per runtime per host, every
agent that needs a fresh credential waits on and reuses that single outcome, and a turn is only
spawned once its credential is confirmed to outlast the turn.

## Requirements

### Requirement: At most one credential refresh is in flight per runtime per host

For a runtime whose credential the system can read, the system SHALL ensure at most one
credential-refreshing operation is in flight for that runtime at any time, across every workspace and
every agent on the host that shares it.

An agent that needs the same runtime's credential while a refresh for it is already in flight SHALL
NOT start a refresh of its own. It SHALL wait for the in-flight refresh and use its outcome.

This SHALL hold regardless of how many agents need the credential at once and regardless of which
workspace they belong to.

#### Scenario: A burst of spawns causes one refresh

- **WHEN** several agents on the same runtime need to spawn a turn at the same moment, and the
  runtime's credential needs refreshing
- **THEN** exactly one refresh is performed for that runtime
- **AND** every agent proceeds using that refresh's outcome rather than its own

#### Scenario: Agents in different workspaces share the same wait

- **WHEN** agents in two different workspaces on the same host need the same runtime's credential at
  the same moment, and it needs refreshing
- **THEN** only one refresh is performed, and both agents' turns proceed from its outcome

#### Scenario: No refresh is needed

- **WHEN** an agent needs to spawn a turn and the runtime's credential is already valid for long
  enough
- **THEN** no refresh is performed and the turn spawns without waiting on anything

### Requirement: A turn spawns only once its credential is confirmed to outlast it

Before spawning a turn on a runtime whose credential the system can read, the system SHALL confirm
that the credential is valid for at least the turn's own expected duration. It SHALL NOT spawn the
turn while that is not yet confirmed.

A runtime whose adapter cannot report its own credential state SHALL be spawned exactly as before
this requirement existed: this requirement SHALL NOT change behavior for a runtime that offers no
way to check.

#### Scenario: A near-expiry credential is refreshed before the turn starts

- **WHEN** an agent is about to take a turn and its runtime's credential would expire before the
  turn's timeout elapses
- **THEN** the turn does not spawn until the credential has been confirmed valid for at least that
  long

#### Scenario: A runtime with no credential state is unaffected

- **WHEN** an agent takes a turn on a runtime whose adapter cannot report credential facts
- **THEN** the turn spawns as it always did, with no freshness check performed

### Requirement: A refresh that cannot restore a working credential is one authentication failure, not several

When the refresh required by this capability cannot restore a working credential, every agent that
was waiting on it SHALL be treated as though its own turn had failed to authenticate, and SHALL be
handled by the system's existing response to an authentication failure — one gate, one decision, no
retry — rather than by any separate mechanism.

The system SHALL NOT spawn a turn for an agent whose wait resolved this way.

#### Scenario: A failed shared refresh gates the runtime once

- **WHEN** the one refresh several waiting agents share cannot restore a working credential
- **THEN** the runtime is gated exactly as it would be for a single agent's own authentication
  failure, and no agent that was waiting spawns a turn

#### Scenario: Waiting agents keep their work

- **WHEN** agents are gated because the refresh they were waiting on failed
- **THEN** the wake-ups they were woken for are preserved, unchanged from the system's existing
  authentication-failure behavior
