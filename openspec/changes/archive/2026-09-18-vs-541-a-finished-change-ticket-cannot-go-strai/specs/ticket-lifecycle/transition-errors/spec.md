## REMOVED Requirements

### Requirement: A graph-rejected transition names the reachable statuses

**Reason**: The requirement is unchanged in intent, but its one worked example used `change approved → in_review` as a rejected transition. That transition is now legal (see `ticket-lifecycle/direct-delivery`), so the scenario that asserted it is false and must be replaced by one that uses a transition that stays graph-invalid. The scenario name is part of the requirement block, so the block is removed and re-added with the corrected example rather than silently dropping the assertion.

**Migration**: None for callers. The error's `details.allowed` field, its code `invalid_disposition`, and the reachability it reports are unchanged; only the example transition changed. The replacement requirement is `A graph-invalid transition names the reachable statuses`.

## ADDED Requirements

### Requirement: A graph-invalid transition names the reachable statuses

When a ticket status transition is rejected because the requested `to` status is not reachable from the ticket's current status for its kind (not a stateful guard failure such as a missing work product or missing unblock action), the system SHALL include in the error's `details` the full list of statuses that are reachable from the current status, for that ticket's kind.

#### Scenario: change ticket rejected from approved to merging

- **WHEN** a `change` ticket in status `approved` is transitioned to `merging`
- **THEN** the transition is rejected with error code `invalid_disposition`
- **AND** the error's `details.allowed` lists exactly the statuses reachable from `approved` for a `change` ticket, in the order defined by the transition table
- **AND** `merging` is not among them

#### Scenario: allowed list reflects the ticket's own kind

- **WHEN** a transition is rejected as graph-invalid for a ticket of kind `task`
- **THEN** `details.allowed` lists the statuses reachable from that ticket's current status within the `task` transition graph, not another kind's graph

#### Scenario: stateful guard rejections are unaffected

- **WHEN** a transition is rejected because a required condition is not met even though the `to` status is graph-reachable (for example, `in_review` without a work product, or `blocked` without an unblock action)
- **THEN** the error's `details` does not claim an `allowed` list for that condition
- **AND** adding the `allowed` list to the graph-reachability error does not by itself change which transitions are legal
