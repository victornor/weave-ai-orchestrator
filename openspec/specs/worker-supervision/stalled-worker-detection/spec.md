# worker-supervision/stalled-worker-detection Specification

## Purpose
Defines a stalled worker — an agent with an unfinished ticket that nothing will ever wake again —
independent of run liveness, so the supervisor's periodic sweep can surface it even when no run is
hung or currently executing.

## Requirements

### Requirement: A worker with no possible source of a future wake is detected as stalled

The system SHALL periodically identify every worker agent that meets all of the following at once:

- the agent's status is not `retired`,
- the agent's ticket status is not a terminal status,
- the ticket has no decision in `open` status,
- the agent has no wakeup that is an action path: a wakeup in `claimed` status; a wakeup in `queued`
  status whose source is not `self_scheduled`; or a `self_scheduled` wakeup whose scheduled time has
  not yet passed by more than a fixed grace margin,
- the agent has no run in `queued` or `running` status,
- the agent's `last_run_at` is older than a fixed threshold.

A queued self-wake is a real action path while it is due or imminent, so a worker waiting on one is
making progress on its own. Once its scheduled time has passed by more than the grace margin — long
enough that the dispatcher would have claimed it — it no longer counts, and the worker is treated as
having no source of a future wake. An agent matching all of the above cannot make further progress on
its own: nothing in the system will ever wake it. The system SHALL raise this condition through the
same fault-surfacing pattern used for a stuck live run (a `worker.stalled` event, visible to the
conductor through its digest), and SHALL additionally attempt bounded automatic recovery as defined
below, rather than leaving the worker stalled indefinitely.

#### Scenario: A worker whose last turn ended cleanly with nothing left to wake it is flagged

- **WHEN** a worker's most recent run finished with status `succeeded`, no wakeup was ever queued for
  it afterward, its ticket is still open, and the time since its last run exceeds the threshold
- **THEN** the worker is detected as stalled and a `worker.stalled` event is raised for it

#### Scenario: A worker idle well past its own scheduled self-wake is flagged

- **WHEN** a worker's only queued wakeup is a `self_scheduled` one whose scheduled time passed more
  than the grace margin ago, its ticket is still open, and the time since its last run exceeds the
  threshold
- **THEN** the worker is detected as stalled and a `worker.stalled` event is raised for it

#### Scenario: Detection never resumes the worker itself

- **WHEN** a worker is detected as stalled
- **THEN** detection alone enqueues no wakeup, retry, or restart for it; any wakeup enqueued as a
  result of the stall instead follows the bounded automatic recovery requirement below, which governs
  whether, and how many times, it happens

### Requirement: A worker that could still make progress on its own is never flagged

The system SHALL NOT flag a worker as stalled while any of the conditions above does not hold: a run
is queued or in progress for it, a decision on its ticket is still open, a wakeup that is an action
path is queued or claimed for it, its ticket has reached a terminal status, or its ticket is
`blocked`. A queued `self_scheduled` wakeup is an action path while it is due or not yet past its
scheduled time by more than the grace margin, and is not one after that. A `blocked` ticket is
excluded explicitly, and not only through the open-decision condition, because a block is not always
represented by an open decision — a ticket-level blocker reference or an `{owner, action}` unblock can
leave a worker legitimately waiting with none of the other conditions in play either.

#### Scenario: A worker mid-run is not flagged

- **WHEN** a worker has a run in `running` status, however long ago its previous run finished
- **THEN** the worker is not detected as stalled

#### Scenario: A worker with an open decision is not flagged

- **WHEN** a worker's ticket has a decision in `open` status awaiting an answer, and the worker's
  `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker with a wakeup already queued is not flagged

- **WHEN** a worker has a queued or claimed wakeup whose source is not `self_scheduled`, and its
  `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker waiting on a pending self-wake is not flagged

- **WHEN** a worker has a queued `self_scheduled` wakeup whose scheduled time is in the future, and
  its `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker a moment past its self-wake is not flagged yet

- **WHEN** a worker has a queued `self_scheduled` wakeup whose scheduled time passed less than the
  grace margin ago
- **THEN** the worker is not detected as stalled

#### Scenario: A worker on a terminal ticket is not flagged

- **WHEN** a worker's ticket status is a terminal status (`done` or `cancelled`)
- **THEN** the worker is not detected as stalled, whatever its `last_run_at`

#### Scenario: A worker on a blocked ticket is not flagged, even with no open decision

- **WHEN** a worker's ticket status is `blocked`, no decision on that ticket is open, and every other
  stalled-worker condition also holds
- **THEN** the worker is not detected as stalled

### Requirement: The threshold is comfortably longer than an ordinary gap between turns

The stall threshold SHALL be a fixed, workspace-configurable duration chosen to be long enough that no
healthy worker waiting for its next ordinary turn is ever flagged, and short enough that a genuine
stall is detected well before it would otherwise go unnoticed for tens of minutes.

#### Scenario: A worker just past the end of a turn is not flagged

- **WHEN** a worker's last run finished less than the threshold ago, and every other stalled-worker
  condition also holds
- **THEN** the worker is not detected as stalled

### Requirement: An interactive session is never flagged as stalled

The system SHALL NOT detect a worker as stalled when its ticket is an interactive session. A
finished conversation on an open interactive ticket is complete success, not a worker that cannot
make further progress. The existing idle-session end remains the way a silent session is closed. This
exclusion also applies to the bounded automatic recovery and escalation requirements below: an
interactive session is never recovered or escalated, because it is never detected as stalled in the
first place.

#### Scenario: An interactive session past the stall threshold is not flagged

- **WHEN** a worker's ticket is an interactive session, its most recent run finished longer ago than
  the stall threshold, and every other stalled-worker condition also holds
- **THEN** the worker is not detected as stalled, no `worker.stalled` event is raised for it, and no
  recovery wake is enqueued for it

### Requirement: An operational ticket awaiting action approval is never flagged as stalled

The system SHALL NOT detect a worker as stalled when its ticket is `operational` and that ticket
has an `action_approval` in `open` status. Waiting for the human to approve an action is a live
action path, not a worker that cannot make further progress. The existing open-decision exemption
already implies this; this requirement names the operational wait so it cannot be dropped when
stall conditions are edited.

#### Scenario: An operational worker past the stall threshold with an open action approval is not flagged

- **WHEN** a worker's ticket is `operational`, an `action_approval` on that ticket is `open`, the
  worker's most recent run finished longer ago than the stall threshold, and every other
  stalled-worker condition also holds
- **THEN** the worker is not detected as stalled and no `worker.stalled` event is raised for it

### Requirement: A detected stall triggers a bounded automatic recovery wake to the same worker

When a worker is detected as stalled, the system SHALL enqueue a wakeup for that same worker agent —
the same agent id, never a newly spawned or re-bound agent — so its ticket can continue, provided the
number of automatic recovery attempts already made for this stall is below a fixed, workspace-
configurable cap. The wakeup SHALL be enqueued through the same wake path used for every other wake,
and SHALL carry a reason that identifies it as an automatic recovery and states which attempt it is.

The system SHALL track, per worker, the number of automatic recovery attempts made since the worker
was last known to have made observable progress on its ticket. "Observable progress" SHALL be judged
by the same evidence test the stuck-worker gate uses: a ticket comment, a ticket document revision, a
ticket work product, or a knowledge revision authored under a run of that worker's, or the ticket's
status having changed, since the last recovery attempt (or since the stall was first detected, if no
attempt has been made yet). Once evidence of progress is found, the attempt count SHALL reset to
zero, so a worker that stalls again later is given the full number of attempts again.

The system SHALL NOT enqueue a second automatic recovery wake for the same worker while an earlier one
it enqueued is still queued, claimed, or has not yet been followed by either a finished run or a reset
of the attempt count.

#### Scenario: A first-time stall gets an automatic recovery attempt

- **WHEN** a worker is detected as stalled and no automatic recovery attempt has been made for it
  since its last observable progress
- **THEN** a wakeup naming the recovery is enqueued for that same worker agent, and the attempt count
  for it becomes one

#### Scenario: Progress since the last attempt resets the count

- **WHEN** a worker was automatically recovered, its resulting run produced observable evidence of
  progress on its ticket, and the worker later stalls again
- **THEN** the attempt count for the new stall starts from zero, as if no prior attempt had been made

#### Scenario: A recovery attempt with no evidence does not reset the count

- **WHEN** a worker was automatically recovered and its resulting run produced no observable evidence
  of progress on its ticket, and the worker stalls again immediately afterward
- **THEN** the attempt count for the new stall continues from where it left off, not from zero

#### Scenario: No second wake while one is already outstanding

- **WHEN** a worker has an automatic recovery wakeup that is still queued or claimed
- **THEN** the sweep does not enqueue a second one for it

#### Scenario: The recovery wake never creates a second worker

- **WHEN** a worker is automatically recovered
- **THEN** the ticket's assigned worker stays the same agent id throughout, and the pending-spawn
  sweep does not spawn or bind a second worker for that ticket at any point during the recovery

### Requirement: Exhausting the automatic recovery attempts escalates to the weaver instead of retrying forever

When a worker's automatic recovery attempt count reaches the configured cap and the worker is
detected as stalled again with no observable progress since the last attempt, the system SHALL NOT
enqueue a further automatic recovery wake. Instead it SHALL raise a `gate_finding` decision owned by
the weaver, attached to the worker's ticket, naming the worker, the ticket, and how many automatic
recovery attempts were made. The decision SHALL be raised at most once per stall: the system SHALL use
a correlation key stable for that worker so a second detection while the decision is still open does
not raise a duplicate.

Because an open decision on the ticket already excludes the worker from stalled-worker detection, this
decision itself SHALL stop further detection, further recovery attempts, and further escalation for
that worker until the weaver resolves it.

#### Scenario: The cap is reached

- **WHEN** a worker's automatic recovery attempt count already equals the configured cap and it is
  detected as stalled again with no observable progress since the last attempt
- **THEN** no further automatic recovery wake is enqueued for it, and a `gate_finding` decision owned
  by the weaver is raised on its ticket naming the worker and the attempt count

#### Scenario: The escalation is not duplicated

- **WHEN** a worker's escalation decision is already open
- **THEN** the worker is not detected as stalled again while that decision stays open, and no second
  escalation decision is raised for it

#### Scenario: Resolving the escalation allows detection again

- **WHEN** the weaver resolves an open escalation decision for a worker
- **THEN** that worker becomes eligible for stalled-worker detection again on the same terms as any
  other worker

### Requirement: The automatic recovery cap is configurable with a stated default

The number of automatic recovery attempts before escalation SHALL be a fixed, workspace-configurable
value with a stated default and documented reasoning, independent of the stall detection threshold
itself.

#### Scenario: The default cap applies unconfigured

- **WHEN** a workspace has not configured the automatic recovery cap
- **THEN** the system uses the documented default value

### Requirement: The system persists that a worker is in an active stall or recovery cycle

The system SHALL persist, for a worker currently subject to stalled-worker detection or automatic
recovery, the fact that it is in that state — from the moment it is first detected as stalled until
either it is found to have made observable progress or its escalation is resolved — rather than only
emitting a transient event for it. This persisted fact SHALL be readable independently of the sweep
that produced it, and SHALL remain readable across the sweep's own periodic cycles rather than
disappearing once the triggering event has scrolled out of the digest.

#### Scenario: The stalled fact outlives one digest cycle

- **WHEN** a worker was detected as stalled and the digest cycle that first reported it has since
  passed
- **THEN** the fact that the worker is in an active stall/recovery cycle is still readable

#### Scenario: The fact clears on progress

- **WHEN** a worker in an active stall/recovery cycle is found to have made observable progress on its
  ticket
- **THEN** the persisted fact no longer marks it as being in an active stall/recovery cycle
