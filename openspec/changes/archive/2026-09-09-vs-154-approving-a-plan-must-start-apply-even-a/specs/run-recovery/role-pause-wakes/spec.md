## Purpose

Keeps work that arrived while a role was paused — especially a plan approval — so that resuming the role starts those turns instead of leaving the tickets idle until someone relaunches them by hand.

## ADDED Requirements

### Requirement: A wake for a worker whose role is paused stays queued

When a wake is enqueued for a worker whose role is `paused`, the system SHALL record that wake as queued and SHALL NOT mark it skipped. The pause SHALL still prevent the turn from starting: the dispatcher SHALL NOT claim that wake while the role remains `paused`.

A wake for a paused *agent* (the worker itself, not its role), a retired or done agent, a retired role, or a workspace that is not active SHALL still be skipped, as today.

#### Scenario: Plan approved while the role is paused

- **WHEN** a `change` ticket's plan is approved and that ticket's worker's role is `paused`
- **THEN** a wake for the apply turn is queued for that worker
- **AND** no run starts for that worker until the role is `active`

#### Scenario: Other wakes for a paused role also wait

- **WHEN** any wake is enqueued for a live worker whose role is `paused`
- **THEN** that wake is queued, not skipped
- **AND** it is not claimed while the role remains `paused`

#### Scenario: A paused agent is still skipped

- **WHEN** a wake is enqueued for an agent whose own status is `paused`, `retired`, or `done`
- **THEN** that wake is skipped with the same skip reason it has today

### Requirement: Resuming a role starts the turns that waited

When a paused role becomes `active`, every wake that was left queued for that role's live workers SHALL become eligible to start on the ordinary dispatcher cadence. Resuming SHALL NOT require reconstructing skipped rows, spawning a second worker, or a manual relaunch.

#### Scenario: Role paused, plan approved, role resumed, apply starts

- **WHEN** a role is paused, a plan for one of its live workers is then approved, and the role is later resumed
- **THEN** that worker takes an apply turn without anyone relaunching it

#### Scenario: Resume with nothing waiting is a no-op for wakes

- **WHEN** a paused role with no queued wakes for its live workers is resumed
- **THEN** no wake is invented and no turn starts solely because of the resume

### Requirement: A skipped wake does not consume its idempotency key

An idempotency key whose only matching wake is `skipped`, `cancelled`, or `failed` SHALL NOT prevent a later enqueue of the same key from queueing a new wake. A key that already has a `queued`, `claimed`, `coalesced`, or `completed` wake SHALL still return that existing wake.

#### Scenario: Liveness can recover after a skipped repair wake

- **WHEN** a wake with an idempotency key was recorded as skipped, and a later enqueue uses the same key while the agent and role are able to run
- **THEN** a new wake is queued rather than returning the skipped row

#### Scenario: A queued or completed key is still unique

- **WHEN** a wake with an idempotency key is already queued or completed
- **THEN** a later enqueue of the same key returns that existing wake and does not add another
