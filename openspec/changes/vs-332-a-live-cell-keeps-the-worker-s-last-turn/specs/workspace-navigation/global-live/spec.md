## ADDED Requirements

### Requirement: A global Live cell keeps the worker's last turn as per-workspace Live does

A global Live cell SHALL keep its worker's most recent run's transcript on screen between turns,
render the waiting line as a footer below it, and hand off to the next run without a blank cell,
exactly as a per-workspace Live cell does (`workspace-navigation/live-floor`). A cell showing a
finished run's transcript SHALL open no run-event stream and SHALL NOT hold a run-tail `EventSource`
slot.

#### Scenario: A global cell's last turn stays on screen

- **WHEN** a live worker in any hosted workspace has a finished most recent run and no in-progress
  run
- **THEN** its global Live cell shows that run's transcript with the waiting line as a footer below
  it, and opens no run-event stream

#### Scenario: A global cell hands off to the next run

- **WHEN** a worker whose finished run is on a global Live cell starts a new in-progress run
- **THEN** that cell opens the new run's live stream without a blank cell in between
