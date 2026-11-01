## Purpose

Lets anyone outside the daemon tell, in one read, whether a quiet workspace is idle and waiting on a human or actually stalled. An active unit and a live process cannot show that difference.

## ADDED Requirements

### Requirement: `/api/health` reports each workspace's supervisor

`GET /api/health` SHALL include, for each loaded workspace, a `supervisor` object with these fields:

- `state`
- `lastTickStartedAt`, `lastTickFinishedAt`
- `stepsInFlight`: a list of `{ step, sinceMs }`
- `lastWakeAt`: the newest `wakeups.created_at` in the workspace, or null
- `activeRuns`
- `queuedWakes`: queued and due
- `openHumanDecisions`
- `oldestHumanDecisionAgeMs`, measured on the reminder clock

It SHALL NOT include decision titles, ticket titles or agent names, because the route is unauthenticated.

#### Scenario: Health after a quiet day
- **WHEN** a workspace's ticks finish every 15 s, no run is active, no wake is queued, and one human-owned merge card has been open and reviewed for 20 h
- **THEN** its `supervisor.state` is `idle_waiting_on_human`, `openHumanDecisions` is 1, `oldestHumanDecisionAgeMs` is about 72,000,000, and `lastWakeAt` is 20 h old

### Requirement: The supervisor state is derived in a fixed order

The state SHALL be the first of the following that holds:

1. `stalled`: the supervisor is started and no tick has finished for 10 minutes since start or since the last finished tick, or some step has been in flight for 30 minutes.
2. `starting`: no tick has finished yet.
3. `active`: a run is running, or a wake is queued or claimed.
4. `idle_waiting_on_human`: at least one open human-owned decision exists.
5. `idle`: none of the above.

#### Scenario: Each state
- **WHEN** the inputs match exactly one row of the order above
- **THEN** that row's state is reported

### Requirement: `ok` is false only for a stalled supervisor

The top-level `ok` in `/api/health` SHALL be `false` if and only if some workspace's supervisor state is `stalled`. `idle`, `idle_waiting_on_human` and `starting` SHALL leave it `true`. The response SHALL be HTTP 200 unless the request carries `?strict=1` and `ok` is `false`, in which case it SHALL be HTTP 503 with the same body.

#### Scenario: Waiting on a human
- **WHEN** every workspace is `idle_waiting_on_human`
- **THEN** `ok` is `true` and the status is 200, with or without `strict=1`

#### Scenario: Stalled with strict
- **WHEN** one workspace is `stalled` and the request is `GET /api/health?strict=1`
- **THEN** the status is 503 and `ok` is `false`

### Requirement: `weave daemon status` shows the supervisor state

`weave daemon status` SHALL print one line per workspace with its supervisor state, the age of its last finished tick, the age of its last wake, and its count of open human decisions. Its `--json` output SHALL carry the `supervisor` objects unchanged.

#### Scenario: Status while waiting on the human
- **WHEN** a workspace is `idle_waiting_on_human`
- **THEN** its line reads that state with the last-tick age in seconds and the open-decision count
