## MODIFIED Requirements

### Requirement: A worker with no possible source of a future wake is detected as stalled

The system SHALL periodically identify every worker agent that meets all of the following at once:

- the agent's status is not `retired`,
- the agent's ticket status is not a terminal status,
- the ticket has no decision in `open` status,
- the agent has no wakeup that is an action path: a wakeup in `claimed` status; a wakeup in `queued`
  status whose source is not `self_scheduled`; or a `self_scheduled` wakeup whose scheduled time has
  not yet passed by more than a fixed grace margin,
- the agent has no run in `queued` or `running` status,
- the agent's ticket is not `merging` while still waiting for merge-queue admission,
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

#### Scenario: A worker waiting for merge-queue admission is not flagged

- **WHEN** a worker's ticket is `merging` with `merge_started_at` null (waiting for a merge slot to
  free), no wakeup is queued for the worker, no run is running for it, and the time since its last
  run exceeds the threshold
- **THEN** the worker is not detected as stalled, no `worker.stalled` event is raised for it, and it
  is never selected by the bounded automatic recovery or escalation steps

#### Scenario: A worker holding the merge slot is still flagged when it goes quiet

- **WHEN** a worker's ticket is `merging` with `merge_started_at` set, it holds the project's merge
  slot, no wakeup is queued for it and no run is running for it, and the time since its last run
  exceeds the threshold
- **THEN** the worker is detected as stalled on the same terms as any other worker, and the bounded
  automatic recovery requirement applies to it

## ADDED Requirements

### Requirement: A worker correctly waiting for merge-queue admission is not treated as stalled

The system SHALL distinguish a worker whose ticket is waiting for merge-queue admission from one
that cannot make further progress. A ticket waiting for admission is a `merging` ticket whose
`merge_started_at` is null: the ticket has joined its project's queue and the queue's own pump —
which runs on the supervisor tick and again whenever a slot frees — will stamp the admission and
enqueue a wake for this same worker when a slot becomes available. Nothing else starts a merge turn,
so this wait is a live action path and the worker SHALL NOT be flagged as stalled, SHALL NOT receive
an automatic recovery wake, SHALL NOT be escalated to the weaver, and SHALL NOT be persisted as being
in an active stall/recovery cycle. The exclusion is this narrow admission state, never the `merging`
status as a whole: a worker that holds the merge slot (`merge_started_at` set) is not excluded and
remains a stall candidate, because a slot holder that goes quiet is exactly the stranded worker this
detection exists for.

No separate age or duration bound SHALL be applied to a waiting worker. Its wait is bounded by the
slot it is queued behind, and the slot holder is supervised independently: the merge-checks alarm
(`mergeChecksAlarmSec`) surfaces a holder whose checks stay unresolved, and this same stalled-worker
detection catches a holder whose worker has gone quiet. A queue that never drains is therefore always
traceable to a slot holder that is itself being surfaced; a second timeout on the waiters would
duplicate that escalation and re-create the false positive this requirement removes.

This exclusion applies to the persisted stall fact as well: a worker that already has a
`worker_stall_state` row and then enters the merge-queue wait SHALL have that row cleared, so the
workers and tickets reads no longer render it as stalled while it legitimately waits.

#### Scenario: A queued-but-not-admitted worker produces no nudge and no finding

- **WHEN** a worker's ticket is `merging` with `merge_started_at` null, the worker has no queued
  wakeup and no running run, and its `last_run_at` is older than the stall threshold
- **THEN** no automatic recovery wake is enqueued for it, no `gate_finding` is raised, and no
  `worker_stall_state` row is created for it

#### Scenario: A slot-holding worker that ended a turn with work left and no wake is still recovered

- **WHEN** a worker's ticket is `merging` with `merge_started_at` set, the worker has no queued
  wakeup and no running run, and its `last_run_at` is older than the stall threshold
- **THEN** the worker is detected as stalled and a bounded automatic recovery wake is enqueued for it

#### Scenario: The persisted stalled fact clears when the worker enters the queue wait

- **WHEN** a worker has a `worker_stall_state` row and its ticket then becomes `merging` with
  `merge_started_at` null
- **THEN** the row is cleared and the worker's read no longer marks it as stalled
