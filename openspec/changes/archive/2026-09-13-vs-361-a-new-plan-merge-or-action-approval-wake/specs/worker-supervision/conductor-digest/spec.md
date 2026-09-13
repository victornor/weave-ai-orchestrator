## ADDED Requirements

### Requirement: The digest drops only decisions the weaver itself asked

The digest SHALL include a `decision.created` event when the decision was raised by an agent other than the weaver — a worker, or the system with no asking agent — regardless of which side owns the approving answer. It SHALL drop a `decision.created` event only when the decision's asking agent is the weaver itself, because a card the weaver raised is not news to it.

This restores a worker-raised human-owned approval — every `plan_approval`, `merge_approval` and `action_approval` a worker raises — as a digest event, while a decision the weaver asked the human stays out.

#### Scenario: A worker-raised human-owned approval is digest news

- **WHEN** a worker raises a human-owned `merge_approval` and a digest is built that covers its creation
- **THEN** the digest includes the `decision.created` event for it

#### Scenario: A system-raised human-owned approval is digest news

- **WHEN** the system raises a human-owned `plan_approval` (with no asking agent) and a digest is built that covers its creation
- **THEN** the digest includes the `decision.created` event for it

#### Scenario: A weaver-raised decision is dropped

- **WHEN** the weaver itself asks the human a `question`, and a digest is built that covers its creation
- **THEN** the digest drops that `decision.created` event
