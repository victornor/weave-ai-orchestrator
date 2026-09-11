## Purpose

Defines the drain-before-kill sequence every operator-initiated restart of the daemon goes through:
a bounded wait over HTTP for running turns to finish, cancellation of whatever is left when that
budget runs out, and the same treatment for a plain stop as an upgrade or restart already gets.

## ADDED Requirements

### Requirement: The drain endpoint cancels whatever is still running when its own budget runs out

`POST /api/daemon/drain` SHALL wait up to the requested budget for every workspace's dispatcher to
finish its in-flight turns. If that budget elapses with turns still running, it SHALL cancel each of
them through the same path used to cancel a run on request, before responding.

#### Scenario: Every turn finishes within the requested budget

- **WHEN** `POST /api/daemon/drain` is called with a budget, and every in-flight turn finishes before
  it elapses
- **THEN** the response reports nothing still running, and no run is cancelled

#### Scenario: The budget runs out with turns still running

- **WHEN** `POST /api/daemon/drain`'s budget elapses with turns still running
- **THEN** each of those turns is cancelled before the response is sent, and the response reports them
  as still running at the time the budget ran out

### Requirement: `daemon stop` requests the same bounded drain a restart already does

Stopping the daemon from the CLI SHALL request a bounded drain over HTTP before sending its
termination signal, the same way restarting, upgrading or rolling back the daemon already does.

#### Scenario: A plain `daemon stop` drains before signalling

- **WHEN** an operator runs the command that stops the daemon locally
- **THEN** a bounded drain request is made before the daemon is signalled to terminate, and any turn
  still running when that drain's budget runs out is reported as interrupted
