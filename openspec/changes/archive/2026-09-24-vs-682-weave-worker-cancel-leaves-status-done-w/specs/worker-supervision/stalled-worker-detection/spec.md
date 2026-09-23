## MODIFIED Requirements

### Requirement: A worker with no possible source of a future wake is detected as stalled

The system SHALL periodically identify every worker agent that meets all of the following at once:

- the agent's status is not `retired` and not `done`,
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

An agent's own `status` of `done` is a standing terminal-ish state on its own, independent of its
ticket's status: a cancelled worker (`weave_worker_cancel`) and a normally-finished worker whose work
has not yet landed (VS-333) both park at `status: 'done'` with their ticket possibly still open, and
neither is waiting on a future wake it can act on — it is waiting on a human decision (relaunch,
cancel the ticket, or approve landing) that arrives through a different path entirely, never through
this detection. It SHALL be excluded on the same terms as `retired`.

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

#### Scenario: A cancelled worker parked at status done is not flagged

- **WHEN** a worker was cancelled and its agent `status` is `done`, its ticket is still open, no
  wakeup is queued for it, no run is running for it, and the time since its last run exceeds the
  threshold
- **THEN** the worker is not detected as stalled, no `worker.stalled` event is raised for it, no
  automatic recovery wake is enqueued for it, and no `gate_finding` escalation is raised for it —
  whatever the ticket's own status

#### Scenario: A normally-finished worker parked at status done pending landing is not flagged

- **WHEN** a worker's work finished but has not yet landed, its agent `status` is `done`, its ticket
  is still open, no wakeup is queued for it, no run is running for it, and the time since its last
  run exceeds the threshold
- **THEN** the worker is not detected as stalled and no `worker.stalled` event is raised for it
