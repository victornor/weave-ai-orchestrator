## ADDED Requirements

### Requirement: A decision-review wake names the decision in the weaver's prompt

When the daemon renders the weaver's per-turn prompt and one of the wakes that woke it carries a decision id for a review-carrying decision, the "Why you were woken" line for that wake SHALL name the decision — its id, and at least its kind — so the weaver can review that specific decision in the turn rather than inferring which card is new. A wake that carries no decision id SHALL render exactly as before.

#### Scenario: The wake line names the decision

- **WHEN** the weaver's prompt is built for a turn woken by a decision-review wake carrying a `decisionId`
- **THEN** the wake line in "Why you were woken" shows that decision id and its kind

#### Scenario: An unrelated wake is unchanged

- **WHEN** the weaver's prompt is built for a turn woken by a wake that carries no decision id
- **THEN** its wake line renders as it did before
