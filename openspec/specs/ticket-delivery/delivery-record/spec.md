# ticket-delivery/delivery-record Specification

## Purpose
Defines when a finished ticket's delivery record is complete, how an incomplete one is shown on the ticket's own surfaces, and that only merge-done writes the merging-to-done edge.

## Requirements

### Requirement: A complete delivery records the merge that merge-done writes

When merge-done accepts a ticket, the ticket's delivery record SHALL include `merged` set to true and a non-empty `mergeCommit`. A `done` ticket whose delivery claims a merge — `prState` is `merged`, or `merged` is true — and that is missing either of those two fields SHALL be an incomplete delivery. A `done` ticket that does not claim a merge (no delivery, a pull request that is not merged, a scout or question ending, a task that finished with nothing to land) SHALL NOT be an incomplete delivery.

#### Scenario: The VS-227 shape is incomplete

- **WHEN** a ticket is `done` and its delivery is a pull-request URL with `prState` `merged` and neither `merged: true` nor a `mergeCommit`
- **THEN** that ticket has an incomplete delivery

#### Scenario: merge-done's record is complete

- **WHEN** a ticket is `done` and its delivery has `merged` true and a non-empty `mergeCommit`
- **THEN** that ticket does not have an incomplete delivery

#### Scenario: A no-diff ending is not incomplete

- **WHEN** a `done` ticket has no delivery, or has a pull-request URL whose `prState` is not `merged` and does not have `merged` true
- **THEN** that ticket does not have an incomplete delivery

### Requirement: An incomplete delivery is visible on the ticket

A ticket with an incomplete delivery SHALL be distinguishable from a normally merged ticket on the board (and any card that shows a finished ticket's outcome), on the ticket detail view, and in `conductor ticket show`. The outcome SHALL NOT read as an ordinary merge. `conductor doctor` SHALL NOT report ticket-delivery incompleteness. The daemon SHALL NOT wake the conductor, SHALL NOT rewrite historical delivery rows, and SHALL NOT raise a decision, solely because a ticket has an incomplete delivery.

#### Scenario: The board does not treat it as a normal merge

- **WHEN** a `done` ticket has an incomplete delivery
- **THEN** its outcome chip does not use the same label and tone as a ticket whose delivery was written by merge-done

#### Scenario: Ticket detail names the gap

- **WHEN** the ticket detail view is shown for a `done` ticket with an incomplete delivery
- **THEN** the view states that delivery is incomplete (missing merge commit), rather than only showing a merged pull-request state

#### Scenario: CLI show names the gap

- **WHEN** `conductor ticket show` is run for a `done` ticket with an incomplete delivery
- **THEN** the printed detail states that delivery is incomplete and that `mergeCommit` is missing

#### Scenario: Doctor and the conductor are not involved

- **WHEN** a workspace contains one or more `done` tickets with incomplete delivery
- **THEN** `conductor doctor` does not fail because of them
- **AND** the conductor is not woken about them

### Requirement: Only merge-done moves a ticket from merging to done

A status transition to `done` from `merging` SHALL be rejected. The ticket SHALL remain `merging`. The error SHALL tell the caller to report the merge through merge-done instead. merge-done itself SHALL still be able to finish a `merging` ticket as `done` and SHALL still write the complete delivery record.

#### Scenario: Transition from merging to done is refused

- **WHEN** a ticket in `merging` is transitioned to `done`
- **THEN** the transition is rejected
- **AND** the ticket stays `merging`
- **AND** the error names merge-done as the way to finish

#### Scenario: merge-done still finishes the ticket

- **WHEN** merge-done accepts a ticket that is in `merging`
- **THEN** the ticket is `done` and its delivery is complete
