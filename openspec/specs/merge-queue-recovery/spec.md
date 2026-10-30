# merge-queue-recovery Specification

## Purpose
Keeps a ticket that was blocked out of the merge queue from waiting for an admission that cannot come, and makes a stranded one visible with its repair.

## Requirements

### Requirement: A retry returns a merge-blocked ticket to the queue before its worker runs

Answering a retry for a worker whose ticket is `blocked` with `blocked_from_status = merging` SHALL transition the ticket back to `merging`, re-stamping its queue entry, before the worker is relaunched. If the transition is refused, the ticket SHALL carry a status comment naming the refusal and the `weave_ticket_transition` repair.

#### Scenario: Retry card on a ticket blocked out of merging
- **WHEN** a `retry_approval` is answered for a worker whose ticket is blocked from `merging` with null queue timestamps
- **THEN** the ticket is `merging` with `merge_queued_at` set by the time the worker is relaunched

#### Scenario: Restore refused
- **WHEN** the transition back to `merging` throws
- **THEN** a status comment on the ticket names the error and the repair command

### Requirement: The digest names a ticket stranded out of the merge queue

The weaver's open-work digest SHALL list every ticket that is `blocked`, has `blocked_from_status = merging` and null `merge_queued_at` and `merge_started_at` under a "Needs attention" heading, with the repair `weave_ticket_transition("<id>", "merging")`.

#### Scenario: Stranded ticket
- **WHEN** a ticket is blocked from `merging` with null queue timestamps
- **THEN** the digest names it and the repair

#### Scenario: Queued ticket
- **WHEN** the ticket has a `merge_queued_at`
- **THEN** it is not listed
