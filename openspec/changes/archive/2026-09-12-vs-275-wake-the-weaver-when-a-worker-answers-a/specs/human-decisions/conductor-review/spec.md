## ADDED Requirements

### Requirement: Answering a held review wakes the weaver

When an agent other than the weaver comments on a ticket that has at least one `open` decision currently marked **looked at, with concerns**, the daemon SHALL enqueue a wake for the weaver. The wake SHALL name the ticket and state that the held review was answered, and its payload SHALL carry the id of a decision on that ticket that is marked **looked at, with concerns**. At most one wake SHALL be enqueued per comment, however many such decisions the ticket carries.

The wake is a notification only. It SHALL NOT set, clear, or otherwise change any decision's review state; whether the concern is actually resolved remains the weaver's judgement, recorded only through an explicit review mark.

A comment authored by the weaver SHALL NOT produce this wake. A comment on a ticket with no such decision — because the decision is marked **looked at**, is not `open` (answered, superseded, withdrawn, or expired), or does not exist — SHALL NOT produce it. A comment authored by the human SHALL NOT produce it through this requirement.

Other comment routing SHALL be unaffected: a human's reply still reaches the ticket's worker, and still reaches the weaver only through the existing path for a ticket with no role.

#### Scenario: A worker's comment on a held ticket wakes the weaver

- **WHEN** a worker comments on a ticket whose open `merge_approval` is marked **looked at, with concerns**
- **THEN** exactly one wake is enqueued for the weaver, naming the ticket and the decision id, and the decision remains `open` and marked **looked at, with concerns**

#### Scenario: A worker's status comment counts

- **WHEN** a worker posts a `status` comment on a ticket whose open `plan_approval` is marked **looked at, with concerns**
- **THEN** the weaver is woken, because a worker often reports the fix in a status line

#### Scenario: Two marked decisions still produce one wake

- **WHEN** a worker comments on a ticket that has two open decisions both marked **looked at, with concerns**
- **THEN** a single wake is enqueued for that comment, carrying one of the decision ids

#### Scenario: No held decision means no wake

- **WHEN** a worker comments on a ticket whose decisions are all unmarked or marked **looked at**
- **THEN** no wake is enqueued for the weaver

#### Scenario: The weaver's own comment does not wake the weaver

- **WHEN** the weaver comments on a ticket whose open decision is marked **looked at, with concerns**
- **THEN** no wake is enqueued for the weaver

#### Scenario: A looked at decision does not trigger the wake

- **WHEN** a worker comments on a ticket whose open decision is marked **looked at** with no concerns
- **THEN** no wake is enqueued for the weaver

#### Scenario: An answered decision does not trigger the wake

- **WHEN** a worker comments on a ticket whose only decision marked **looked at, with concerns** has already been answered
- **THEN** no wake is enqueued for the weaver

#### Scenario: Human comment routing is unchanged

- **WHEN** a human replies on a ticket with a live worker and an open decision marked **looked at, with concerns**
- **THEN** the worker is woken exactly as before and no weaver wake is produced by this requirement
