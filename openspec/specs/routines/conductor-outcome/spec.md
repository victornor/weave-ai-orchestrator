# routines/conductor-outcome Specification

## Purpose
Makes a fired routine an instruction for the conductor to look, not a licence to mint tickets every morning, and makes the cost of a fire visible and bounded.

## Requirements

### Requirement: The default outcome of a fire is a report, not new tickets

A routine's action policy SHALL be `report` unless captain sets it to `file_work`. On a `report` fire the conductor SHALL be instructed — by the wake payload and by its standing prompt — to investigate and reply to captain with findings, and SHALL NOT file tickets as the default outcome of that fire. A routine that should file work SHALL say so by storing `file_work` on its own definition.

The daemon SHALL NOT create a ticket merely because a routine fired. `tickets.create` on a conductor run SHALL be rejected when that run's claimed wakes, flattened through coalesced bundles, are exclusively `report` routine fires. A `report` fire that shares the turn with any other wake source SHALL NOT by itself cause that rejection.

#### Scenario: A report routine does not create a ticket by firing

- **WHEN** a routine with action `report` fires
- **THEN** the conductor is woken with that instruction
- **AND** no ticket is created as a result of the enqueue itself

#### Scenario: Filing is an opt-in on the definition

- **WHEN** captain creates a routine with action `file_work`
- **THEN** the stored routine's action policy is `file_work`
- **AND** the fire's wake payload tells the conductor that filing work is allowed for this fire

#### Scenario: Report is the default on create

- **WHEN** a routine is created without an action policy
- **THEN** it is stored as `report`

#### Scenario: A report fire cannot file a ticket from that turn

- **WHEN** the conductor's current turn was woken exclusively by `report` routine fires — no other wake source of any kind
- **AND** it tries to create a ticket
- **THEN** ticket creation is rejected
- **AND** no ticket is stored

#### Scenario: A report fire sharing the turn with other work does not block filing

- **WHEN** the conductor's current turn was woken by a digest, a ticket event, or any other non-routine source, and a `report` routine fire also landed on that turn
- **AND** it creates a ticket
- **THEN** ticket creation succeeds
- **AND** the ticket is stored

### Requirement: Fan-out from a fire is capped

A routine SHALL carry a maximum number of tickets it may originate from a single fire (`maxTicketsPerFire`). For `report` the default SHALL be 0. For `file_work` the default SHALL be 3. The stored value SHALL NOT exceed 8; a higher value SHALL be rejected as `validation`.

When the conductor files a ticket from a `file_work` fire, that ticket SHALL record `origin_kind` `routine` and an origin fingerprint that includes the routine's id. Creating a further ticket from the same fire that would exceed `maxTicketsPerFire` SHALL be rejected. Open tickets already originated by that routine SHALL count toward the cap for that fire.

#### Scenario: Report default cap is zero

- **WHEN** a `report` routine is created without a fan-out cap
- **THEN** `maxTicketsPerFire` is 0

#### Scenario: File-work default cap is three

- **WHEN** a `file_work` routine is created without a fan-out cap
- **THEN** `maxTicketsPerFire` is 3

#### Scenario: A cap above eight is refused

- **WHEN** a routine is created with `maxTicketsPerFire` 9
- **THEN** the request is rejected with `validation` and no routine is stored

#### Scenario: A fourth ticket from a fire of cap 3 is refused

- **WHEN** a `file_work` routine with `maxTicketsPerFire` 3 has already originated three tickets from the current fire
- **AND** the conductor tries to file a fourth from that fire
- **THEN** ticket creation is rejected
- **AND** the fourth ticket is not stored

### Requirement: A routine's spend is attributable to it

Each fire SHALL be attributable as spend: the conductor turn that ran for that wake, plus usage on tickets originated by that routine. A session-authenticated client SHALL read a routine's spend over the same windows the usage API already offers (at least 24 h and 7 d). The Settings section SHALL show that spend next to the routine. This capability SHALL NOT introduce budgets, quotas, or automatic pausing when spend is high.

#### Scenario: The fire's conductor turn is on the routine

- **WHEN** a routine fire's conductor run records usage
- **THEN** that usage is included in the routine's spend

#### Scenario: Originated tickets roll up

- **WHEN** a `file_work` fire originates a ticket and that ticket's worker records usage
- **THEN** that usage is included in the routine's spend

#### Scenario: Settings shows spend

- **WHEN** captain opens Settings → Scheduled tasks
- **THEN** each routine shows spend for a recent window, including zero when it has never fired
