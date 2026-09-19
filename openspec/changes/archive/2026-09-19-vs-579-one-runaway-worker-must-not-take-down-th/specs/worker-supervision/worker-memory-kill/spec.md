## Purpose

Makes a worker killed for exceeding its memory limit legible and recoverable: it ends as a clear failed run rather than an ambiguous interrupt, it is visible on the ticket, and it is retried by the same ladder every other transient failure uses.

## ADDED Requirements

### Requirement: A memory kill is a failed run with a memory reason

A worker turn whose process tree was killed because it exceeded its memory limit — by the kernel inside the worker's control group or by `systemd-oomd` — SHALL end as a run failure whose reason names the memory limit, distinct from a human interrupt, a daemon-shutdown cut, and a watchdog silence cut. The run SHALL carry the peak memory observed for the worker's control group.

A kill the daemon cannot attribute to memory SHALL keep the outcome it has today; the daemon SHALL NOT label every `SIGKILL` a memory kill.

#### Scenario: A worker exceeds its limit
- **WHEN** a worker's process tree is killed for exceeding its memory limit
- **THEN** its run ends `failed` with the memory-limit reason and the peak memory recorded

#### Scenario: A human interrupts a turn
- **WHEN** a human cancels a running turn
- **THEN** it is still recorded as interrupted, not as a memory kill

#### Scenario: The daemon is shutting down
- **WHEN** a turn is cut by a daemon shutdown or drain
- **THEN** it is still recorded as interrupted by shutdown, not as a memory kill

### Requirement: A memory kill is retried like any other transient failure

A memory-killed run SHALL enter the normal retry ladder and be resumed automatically with the same backoff as any other retryable failure, up to the ladder's existing attempt budget. When the budget is spent the worker SHALL be parked for the human with the memory reason, exactly as the ladder parks any exhausted failure.

#### Scenario: A memory-hungry build fails once
- **WHEN** a worker is memory-killed and its retry budget is not spent
- **THEN** a retry wake is scheduled on the worker's normal backoff

#### Scenario: The retry budget is spent
- **WHEN** the worker has exhausted its retries
- **THEN** it is parked for the human with the memory-limit reason on the ticket

### Requirement: A memory kill is visible on the ticket

Every memory kill SHALL record an activity entry scoped to the worker's ticket, naming the ticket and the peak memory, so the human and the weaver can see what happened without reading the run record.

#### Scenario: Looking at the ticket after a kill
- **WHEN** a worker is memory-killed
- **THEN** the ticket's activity shows a memory-limit entry naming the peak memory

### Requirement: A repeat offender files an incident

When workers are memory-killed repeatedly — the same ticket or role killed more than once within the retry window — the daemon SHALL file a system incident naming the ticket, the role and the peak memory, and SHALL NOT file a new incident for every subsequent kill while that incident is open. Filing an incident SHALL NOT by itself stop the retry ladder or the parking path.

#### Scenario: One kill, no incident
- **WHEN** a worker is memory-killed once
- **THEN** an activity entry is recorded and no incident is filed

#### Scenario: A second kill on the same ticket
- **WHEN** the same worker or ticket is memory-killed again while the case is live
- **THEN** a system incident is filed once, naming the ticket, the role and the peak memory

#### Scenario: A third kill while the incident is open
- **WHEN** another memory kill occurs and an incident for it is already open
- **THEN** no second incident is filed
