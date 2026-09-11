## MODIFIED Requirements

### Requirement: A routine's spend is attributable to it

Each fire SHALL be attributable as spend: the conductor turn that ran for that wake, plus usage on tickets originated by that routine. A session-authenticated client SHALL read a routine's spend over the same windows the usage API already offers (at least 24 h and 7 d). The Scheduled page SHALL show that spend next to the routine. This capability SHALL NOT introduce budgets, quotas, or automatic pausing when spend is high.

#### Scenario: The fire's conductor turn is on the routine

- **WHEN** a routine fire's conductor run records usage
- **THEN** that usage is included in the routine's spend

#### Scenario: Originated tickets roll up

- **WHEN** a `file_work` fire originates a ticket and that ticket's worker records usage
- **THEN** that usage is included in the routine's spend

#### Scenario: Settings shows spend

- **WHEN** captain opens the Scheduled page
- **THEN** each routine shows spend for a recent window, including zero when it has never fired

## ADDED Requirements

### Requirement: A routine's fires are listed from existing runs

A session-authenticated client SHALL read the fires of one routine as the wakes already stored for
it — `source` `routine` and a payload naming that routine — joined to the conductor run that
claimed them, including a wake that coalesced into another. Each fire SHALL carry when it ran, the
run's status when a run exists, and the run's stored summary when one exists. The lifetime fire
count SHALL be the number of those wakes that were not skipped. Listing SHALL NOT write a second
store of fires; skipped enqueues SHALL NOT appear as fires.

Two wakes that shared one conductor turn SHALL still appear as two fires, each pointing at that
same run's outcome.

A fire's summary is the conductor's end-of-turn summary for that run. When the run's claimed wakes,
flattened through coalesced bundles the same way ticket filing already walks them, include any wake
that is not this routine, the fire SHALL be marked as sharing that turn with other work. A fire
that was the only work on its turn SHALL NOT carry that mark.

#### Scenario: A finished fire is listed from the run

- **WHEN** a routine has enqueued a wake that a conductor run claimed and finished, storing a summary
- **THEN** listing that routine's fires includes that fire with the time it ran, the run's status, and that summary

#### Scenario: A skipped enqueue is not a fire

- **WHEN** a due routine's enqueue is skipped and no wake is kept for it
- **THEN** listing that routine's fires does not include a row for that attempt

#### Scenario: The fire count is the kept wakes

- **WHEN** a routine has three kept `routine` wakes and none skipped
- **THEN** its lifetime fire count is 3

#### Scenario: Two wakes on one run still list as two fires

- **WHEN** two `routine` wakes for the same routine were claimed by one conductor run
- **THEN** listing that routine's fires includes both, each showing that run's status and summary

#### Scenario: A fire that shared its turn is marked

- **WHEN** a routine fire coalesced into a conductor run whose claimed wakes, flattened, also include a human message or any other wake that is not this routine
- **THEN** that fire is marked as sharing the turn with other work
- **AND** the run's summary is still included

#### Scenario: A fire that was the only work is not marked

- **WHEN** a routine fire's conductor run claimed only wakes for that routine
- **THEN** that fire is not marked as sharing the turn
