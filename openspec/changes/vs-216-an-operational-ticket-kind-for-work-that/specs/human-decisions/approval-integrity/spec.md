## ADDED Requirements

### Requirement: An action document on an operational ticket raises an action approval

`action_approval` SHALL be a system-raised, human-owned decision kind. It SHALL NOT be constructable
through `ac_ask`. Its option keys SHALL be `approve`, `revise` and `reject` — the same closed set
`plan_approval` uses — so every surface that renders it as a named card sends only those keys.

Writing the `action` document key on an `operational` ticket SHALL raise (or, on a later revision,
supersede and re-raise) that decision, targeting the new revision. The `plan` document key SHALL
remain reserved to the daemon and SHALL NOT be used for this purpose.

An `operational` ticket that has an `action` document and no open `action_approval` SHALL be
repaired on the same cadence as a stranded `proposed` plan approval: the daemon raises a fresh
`action_approval` targeting the current `action` revision and wakes the conductor naming the ticket
and the missing kind. YOLO SHALL NOT auto-answer a repaired `action_approval`.

#### Scenario: writing action raises the card

- **WHEN** a worker writes an `action` document on an `operational` ticket
- **THEN** an `action_approval` owned by the human is created with options `approve`, `revise` and
  `reject`, targeting that revision

#### Scenario: a later action revision supersedes

- **WHEN** the worker writes a new revision of `action` while an `action_approval` is still open
- **THEN** the previous decision is superseded and a new `action_approval` targets the new revision

#### Scenario: a stranded operational action is repaired

- **WHEN** an `operational` ticket has an `action` document and no open `action_approval`
- **THEN** the daemon raises a fresh `action_approval` for it before the next liveness-scan interval
  has passed twice
- **AND** the conductor is woken naming the ticket and `action_approval`
- **AND** YOLO mode does not answer the repaired decision

#### Scenario: ac_ask cannot construct it

- **WHEN** a worker calls `ac_ask` naming `action_approval`
- **THEN** the call is refused and no decision is created

### Requirement: An action-approval card offers approve, revise and reject

An `action_approval` card SHALL offer exactly the keys the daemon declares when it creates that
kind: `approve`, `revise` and `reject`. This applies to the web app's DecisionCard and to the TUI's
`decisionToCard`.

#### Scenario: the web card's keys

- **WHEN** an `action_approval` card is shown for an open decision
- **THEN** its only actions send `approve`, `revise` or `reject`

#### Scenario: the TUI card's keys

- **WHEN** `decisionToCard` renders an `action_approval` decision
- **THEN** its options send `approve`, `revise` or `reject`, never any other key

## MODIFIED Requirements

### Requirement: An open decision closes when its ticket reaches a terminal status

When a ticket reaches `done` or `cancelled`, every decision still `open` on that ticket SHALL be
withdrawn, whatever kind of decision it is, so it stops asking its owner to act on a ticket that is
already finished. The withdrawal SHALL record why the decision closed without an answer, so it is
auditable later that no one refused or ignored it — its ticket simply finished first.

A decision that has already left `open` status by the time its ticket reaches a terminal status —
answered, expired, superseded, or already withdrawn — SHALL be left exactly as it is.

A decision that carries no `ticketId` — a role hire or retirement approval, a workspace-wide
question, or a runtime-wide notice — is not scoped to any ticket's lifecycle and SHALL NOT be
affected by any ticket reaching a terminal status.

This applies uniformly to every decision kind that can carry a ticket id — `plan_approval`,
`merge_approval`, `retry_approval`, `gate_finding`, `question`, `concern`, and `action_approval` —
since each one exists only to decide something about that specific ticket's own progress, and none
of them has anything left to decide once the ticket is done or cancelled.

#### Scenario: An open merge approval closes when its ticket is done

- **WHEN** a ticket carrying an open `merge_approval` decision reaches `done`
- **THEN** the decision's status becomes `withdrawn` and it no longer appears in a query for `open`
  decisions

#### Scenario: An open plan approval closes when its ticket is cancelled

- **WHEN** a ticket carrying an open `plan_approval` decision reaches `cancelled`
- **THEN** the decision's status becomes `withdrawn`

#### Scenario: An already-answered decision is left alone

- **WHEN** a ticket reaches `done` or `cancelled` and one of its decisions was already `answered`
- **THEN** that decision's status, answer and answered-at fields are unchanged

#### Scenario: A decision not tied to any ticket survives every ticket's terminal transition

- **WHEN** a `hire_approval` decision, which is tied to a role rather than a ticket, is open
- **THEN** no ticket reaching `done` or `cancelled` withdraws it

#### Scenario: An open action approval closes when its ticket is done

- **WHEN** an `operational` ticket carrying an open `action_approval` decision reaches `done`
- **THEN** the decision's status becomes `withdrawn`
