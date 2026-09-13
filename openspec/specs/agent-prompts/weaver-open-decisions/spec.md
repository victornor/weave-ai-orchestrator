# agent-prompts/weaver-open-decisions Specification

## Purpose
The weaver's per-turn prompt lists the open decisions awaiting attention. Each line carries the
decision's age and, when the decision is scoped to a ticket, that ticket's identifier and status, so
a card that has outlived its ticket is distinguishable at a glance from one raised a minute ago.

## Requirements

### Requirement: Open-decision lines carry the decision's age and its ticket's identity and status

The per-turn prompt the daemon renders for the weaver SHALL list each open decision with the age of
that decision — how long it has been open — and, for a decision scoped to a ticket, the identifier
and current status of that ticket, alongside the decision's id, kind, owner and title it already
shows. The age SHALL be shown in the same short relative form used elsewhere in the product (for
example `4m`, `23h`, `6d`).

The age SHALL be derived from the decision's own creation time, so a card raised seconds ago and one
raised the previous day are told apart. A decision scoped to no ticket SHALL still carry its age and
SHALL NOT show a ticket segment.

#### Scenario: A stale card on a finished ticket is visible as stale

- **WHEN** the weaver's prompt lists an open decision created a day earlier on a ticket that is now
  `done`
- **THEN** its line carries the decision's age and the ticket's identifier and `done` status

#### Scenario: A fresh card is told apart from a stale one

- **WHEN** the weaver's prompt lists an open decision created moments ago and an open decision created
  a day earlier
- **THEN** each line shows its own age, so the two are distinguishable

#### Scenario: A decision with no ticket still shows its age

- **WHEN** the weaver's prompt lists an open decision scoped to no ticket
- **THEN** its line shows the decision's age and shows no ticket segment

### Requirement: A decision-review wake names the decision in the weaver's prompt

When the daemon renders the weaver's per-turn prompt and one of the wakes that woke it carries a decision id for a review-carrying decision, the "Why you were woken" line for that wake SHALL name the decision — its id, and at least its kind — so the weaver can review that specific decision in the turn rather than inferring which card is new. A wake that carries no decision id SHALL render exactly as before.

#### Scenario: The wake line names the decision

- **WHEN** the weaver's prompt is built for a turn woken by a decision-review wake carrying a `decisionId`
- **THEN** the wake line in "Why you were woken" shows that decision id and its kind

#### Scenario: An unrelated wake is unchanged

- **WHEN** the weaver's prompt is built for a turn woken by a wake that carries no decision id
- **THEN** its wake line renders as it did before
