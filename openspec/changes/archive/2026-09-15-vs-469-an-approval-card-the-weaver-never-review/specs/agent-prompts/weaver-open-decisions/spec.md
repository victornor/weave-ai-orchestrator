## ADDED Requirements

### Requirement: The weaver's prompt marks an approval still awaiting review

When the per-turn prompt the daemon renders for the weaver lists an open decision whose kind carries
weaver review (`plan_approval`, `merge_approval`, `action_approval`) and whose review state is **not
looked at yet**, that line SHALL say explicitly that the decision has not been reviewed yet, in a form
distinguishable from a line for a decision that is not awaiting review. A line for a decision already
marked **looked at** or **looked at, with concerns**, and a line for a decision of a kind that does
not carry weaver review, SHALL NOT carry the not-reviewed marking.

#### Scenario: An unreviewed approval line is marked

- **WHEN** the weaver's prompt lists an open `merge_approval` whose review state is **not looked at
  yet**
- **THEN** its line carries an explicit not-reviewed marking alongside the id, kind, owner, ticket and
  age it already shows

#### Scenario: A reviewed approval line is not marked

- **WHEN** the weaver's prompt lists an open `merge_approval` already marked **looked at**
- **THEN** its line does not carry the not-reviewed marking

#### Scenario: A non-carrying decision line is unchanged

- **WHEN** the weaver's prompt lists an open `question`
- **THEN** its line renders as before, with no not-reviewed marking
