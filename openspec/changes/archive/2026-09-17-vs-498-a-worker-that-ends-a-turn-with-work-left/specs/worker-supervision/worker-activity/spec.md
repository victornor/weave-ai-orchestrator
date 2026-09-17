## ADDED Requirements

### Requirement: The workers and tickets reads carry the persisted stalled fact

The workers read (the workers list and a worker's own read) and the tickets read SHALL carry, for a
worker in an active stall/recovery cycle (per the stalled-worker-detection capability) and for its
ticket, the fact that it is stalled — distinct from every other status a worker or ticket can be in,
including an ordinary working status and a status where the worker is correctly waiting on someone
else. A worker or ticket not in an active stall/recovery cycle SHALL NOT carry this fact.

While a worker enters or leaves an active stall/recovery cycle, the daemon SHALL push the change to
the board on the workspace event stream the board already consumes, on the same terms as its other
pushed status changes.

#### Scenario: A stalled worker's read carries the fact

- **WHEN** a client reads a worker that is in an active stall/recovery cycle
- **THEN** the response marks that worker as stalled, distinguishably from `active`

#### Scenario: A stalled ticket's read carries the fact

- **WHEN** a client reads a ticket whose assigned worker is in an active stall/recovery cycle
- **THEN** the response marks that ticket as stalled, distinguishably from its ordinary working status

#### Scenario: A working worker's read does not carry the fact

- **WHEN** a client reads a worker with a run in progress, however long that run has been running
- **THEN** the response does not mark that worker as stalled

#### Scenario: A worker correctly waiting is not marked stalled

- **WHEN** a client reads a worker whose ticket has an open decision, a queued action-path wakeup, or
  a scheduled future self-wake
- **THEN** the response does not mark that worker as stalled

#### Scenario: The change is pushed when a worker becomes stalled

- **WHEN** a worker enters an active stall/recovery cycle
- **THEN** the board receives the updated status on the workspace stream without a client having to
  poll for it

#### Scenario: The change is pushed when a worker recovers

- **WHEN** a worker in an active stall/recovery cycle is found to have made observable progress
- **THEN** the board receives the cleared status on the workspace stream
