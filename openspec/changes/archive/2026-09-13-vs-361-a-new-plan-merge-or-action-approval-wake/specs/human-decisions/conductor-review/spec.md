## ADDED Requirements

### Requirement: Creating a review-carrying decision wakes the weaver at once

When a `plan_approval`, `merge_approval` or `action_approval` is created and the weaver did not raise it itself, the daemon SHALL enqueue a wake for the workspace's weaver at creation, without waiting for the periodic digest and regardless of which side owns the approving answer. The wake SHALL come from the system, SHALL name the decision kind, and SHALL carry the decision's id and its ticket's id in its payload, so the weaver can review that decision in the turn it wakes.

The wake SHALL be idempotent per decision: enqueuing for the same decision more than once SHALL NOT produce more than one live wake. A replacement card raised under the same correlation key as a superseded one SHALL wake, because it is a different decision.

The wake SHALL be a notification only. It SHALL NOT set, clear or otherwise change any decision's review state; the review remains the weaver's explicit mark.

#### Scenario: A worker's plan approval wakes the weaver at creation

- **WHEN** a `plan_approval` owned by the human is created by a worker
- **THEN** a wake for the weaver is enqueued in the same creation, naming the `plan_approval` and carrying its decision id and ticket id, with no digest involved

#### Scenario: A merge approval wakes the weaver at creation

- **WHEN** a human-owned `merge_approval` is created
- **THEN** a wake for the weaver is enqueued at creation

#### Scenario: An action approval wakes the weaver at creation

- **WHEN** a human-owned `action_approval` is created
- **THEN** a wake for the weaver is enqueued at creation

#### Scenario: A weaver-raised decision does not produce the review wake

- **WHEN** a `plan_approval`, `merge_approval` or `action_approval` is created with the weaver as the asking agent
- **THEN** no review wake is enqueued for it

#### Scenario: Re-raising under the same correlation key wakes again

- **WHEN** a new review-carrying decision supersedes an older one under the same correlation key
- **THEN** the new decision wakes the weaver, because it is a different decision

#### Scenario: The same decision enqueued twice produces one live wake

- **WHEN** the wake for one review-carrying decision is enqueued and the same decision is enqueued again before the weaver's turn claims it
- **THEN** only one live wake exists for that decision

#### Scenario: A burst of cards coalesces into one turn

- **WHEN** two review-carrying decisions are created within a second, before the weaver's next turn
- **THEN** the wakes coalesce so the weaver takes one turn, not one turn per card

#### Scenario: Kinds that carry no review are unchanged

- **WHEN** a `question`, `hire_approval`, `discard_approval`, `retry_approval`, `concern` or `gate_finding` decision is created
- **THEN** no review wake is enqueued through this requirement

#### Scenario: The wake does not mark the decision reviewed

- **WHEN** the weaver is woken because a review-carrying decision was created and the turn ends without an explicit review mark
- **THEN** the decision's review state is still not looked at yet
