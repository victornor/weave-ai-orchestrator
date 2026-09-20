## ADDED Requirements

### Requirement: The parking card is closed when the worker is put back to work

When a worker with an open parking decision is put back to work — by resuming it, by relaunching it,
or by the automatic resume of a turn a daemon restart interrupted — the system SHALL close that
decision, SHALL record what closed it (naming who or what put the worker back to work and when), and
SHALL leave it out of the human's open decisions. The decision SHALL be recorded as `superseded`, the
same status a repeat failure's replacement uses, so every surface that already drops a superseded
card drops this one too.

The close SHALL apply to every open parking decision raised for that worker, whatever the walk that
reached the resume. It SHALL NOT close a decision the human has already answered, and it SHALL NOT
close a plan, merge, action, promotion, hire or discard approval.

Because no parking decision is left open, a worker that fails again after the resume SHALL raise a
fresh parking decision on the same terms as any other failure.

#### Scenario: The human resumes a parked worker

- **WHEN** a parked worker whose parking decision is still open is resumed
- **THEN** that decision is closed as superseded, carries a note naming the resume, and no longer
  appears in the human's open decisions

#### Scenario: The conductor relaunches a parked worker

- **WHEN** the conductor relaunches a worker parked after a failure, which resumes it
- **THEN** its open parking decision is closed as superseded and no longer appears in the human's
  open decisions

#### Scenario: A daemon restart resumes a cut-off worker

- **WHEN** a worker whose turn a daemon restart interrupted has an open parking decision when the
  daemon resumes it
- **THEN** that decision is closed as superseded and no longer appears in the human's open decisions

#### Scenario: A worker that fails again gets a fresh card

- **WHEN** a worker whose parking decision was closed by a resume fails again
- **THEN** a new parking decision is raised, exactly as for a first failure

#### Scenario: An answered card is left alone

- **WHEN** a worker is resumed while a parking decision for it is already `answered`
- **THEN** that decision is not closed or otherwise changed

### Requirement: An answer to a parking card for a running worker starts nothing

When a parking decision is answered for a worker that is already running — resumed or relaunched
before the answer was processed — the system SHALL NOT start a turn for it, SHALL NOT book a deferred
retry, and SHALL NOT change its worker-model option from that answer. It SHALL record plainly, where
a human can see it, that nothing was started because the worker was already running, rather than
discarding the answer silently.

#### Scenario: A retry answer on a stale card starts no turn

- **WHEN** the human answers a parking decision with the retry option while its worker has already
  resumed
- **THEN** no turn is started for the worker and the fact is recorded where the human can read it

#### Scenario: A deferred retry on a stale card books nothing

- **WHEN** the human answers a parking decision with a deferred-retry option while its worker has
  already resumed
- **THEN** no retry wake is booked for the worker

#### Scenario: A catalog switch on a stale card changes nothing

- **WHEN** the human answers a usage-limit parking decision with a catalog-switch option while its
  worker has already resumed
- **THEN** the ticket's worker-model option is unchanged and no turn is started
