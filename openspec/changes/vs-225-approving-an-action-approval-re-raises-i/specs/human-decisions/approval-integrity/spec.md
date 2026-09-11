## MODIFIED Requirements

### Requirement: An action document on an operational ticket raises an action approval

`action_approval` SHALL be a system-raised, human-owned decision kind. It SHALL NOT be constructable
through `ac_ask`. Its option keys SHALL be `approve`, `revise` and `reject` — the same closed set
`plan_approval` uses — so every surface that renders it as a named card sends only those keys.

Writing the `action` document key on an `operational` ticket SHALL raise (or, on a later revision,
supersede and re-raise) that decision, targeting the new revision. The `plan` document key SHALL
remain reserved to the daemon and SHALL NOT be used for this purpose.

An `operational` ticket SHALL be repaired on the same cadence as a stranded `proposed` plan
approval only when it has an `action` document and the current `action` revision has no
`action_approval` in `open` or `answered` that targets that revision. An answered `approve` or
`revise` is not a missing approval: the daemon SHALL NOT raise a fresh `action_approval` for that
revision, including across repeated repair sweeps. A genuinely lost approval — no `open` or
`answered` card targeting the current revision — SHALL still be repaired: the daemon raises a
fresh `action_approval` targeting that revision and wakes the conductor naming the ticket and the
missing kind. YOLO SHALL NOT auto-answer a repaired `action_approval`.

A later write of `action` (a new revision, including after `revise`) SHALL still raise a fresh
`action_approval` targeting the new revision.

#### Scenario: writing action raises the card

- **WHEN** a worker writes an `action` document on an `operational` ticket
- **THEN** an `action_approval` owned by the human is created with options `approve`, `revise` and
  `reject`, targeting that revision

#### Scenario: a later action revision supersedes

- **WHEN** the worker writes a new revision of `action` while an `action_approval` is still open
- **THEN** the previous decision is superseded and a new `action_approval` targets the new revision

#### Scenario: a stranded operational action is repaired

- **WHEN** an `operational` ticket has an `action` document and no `action_approval` in `open` or
  `answered` targeting that revision
- **THEN** the daemon raises a fresh `action_approval` for it before the next liveness-scan interval
  has passed twice
- **AND** the conductor is woken naming the ticket and `action_approval`
- **AND** YOLO mode does not answer the repaired decision

#### Scenario: ac_ask cannot construct it

- **WHEN** a worker calls `ac_ask` naming `action_approval`
- **THEN** the call is refused and no decision is created

#### Scenario: approving an action approval does not re-raise it

- **WHEN** an `action_approval` targeting the current `action` revision is answered `approve`
- **AND** the repair scan runs, including more than once
- **THEN** no new `action_approval` is created

#### Scenario: an answered revise is not treated as missing

- **WHEN** an `action_approval` targeting the current `action` revision is answered `revise` and the
  worker has not yet written a new `action` revision
- **AND** the repair scan runs
- **THEN** no new `action_approval` is created for that same revision

#### Scenario: a new action revision after revise still raises

- **WHEN** an `action_approval` has been answered `revise` and the worker writes a new revision of
  `action`
- **THEN** a fresh `action_approval` is raised targeting the new revision
