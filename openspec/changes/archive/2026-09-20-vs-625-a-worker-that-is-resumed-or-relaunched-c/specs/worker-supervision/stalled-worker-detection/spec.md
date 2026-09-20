## ADDED Requirements

### Requirement: Resuming or relaunching a stalled worker closes its escalation

When a worker with an open stalled-worker escalation decision is resumed or relaunched, the system
SHALL close that decision and SHALL record what closed it. The escalation exists to tell the
conductor to steer, relaunch or cancel a worker that cannot make further progress on its own; a
worker that has just been put back to work is no longer in that state. The worker SHALL then be
eligible for stalled-worker detection again on the same terms as any other worker.

#### Scenario: Relaunching a stalled worker closes the escalation

- **WHEN** a worker with an open stalled-worker escalation is relaunched
- **THEN** that escalation is closed and carries a note naming the relaunch

#### Scenario: Resuming a stalled worker closes the escalation

- **WHEN** a worker with an open stalled-worker escalation is resumed
- **THEN** that escalation is closed and the worker becomes eligible for detection again
