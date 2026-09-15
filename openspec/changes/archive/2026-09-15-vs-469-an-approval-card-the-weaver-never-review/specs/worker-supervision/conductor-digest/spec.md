## ADDED Requirements

### Requirement: The digest lists approvals still awaiting review as explicit action items

Every digest the supervisor builds SHALL carry, for each open human-owned `plan_approval`,
`merge_approval` or `action_approval` whose review state is **not looked at yet**, an explicit entry
naming the decision, its kind, its ticket when it has one, and how long it has waited. The entry
SHALL be distinguishable from ordinary open work: it is a card the weaver has not reviewed, not one
awaiting the human. A card already marked **looked at** or **looked at, with concerns**, and a
non-carrying kind, SHALL NOT appear in this list. The list SHALL be bounded to a fixed size, like the
digest's existing entries.

The digest's wake reason SHALL name the unreviewed cards, so the weaver can see them without opening
the wake payload, and the digest entry for each SHALL be reachable from the wake.

#### Scenario: A digest after an unreviewed approval lists it as not reviewed

- **WHEN** a worker raises a human-owned `merge_approval` and the next digest is built before the
  weaver reviews it
- **THEN** the digest carries an explicit entry for that decision naming it as not reviewed, with its
  ticket and age, distinct from ordinary open work

#### Scenario: The digest wake reason names the unreviewed cards

- **WHEN** a digest is built while an approval is still **not looked at yet**
- **THEN** the digest's wake reason names that card, so the weaver reads it in its turn without opening
  the payload

#### Scenario: A reviewed approval is not listed as not reviewed

- **WHEN** the weaver has marked an open `plan_approval` **looked at** and a digest is built
- **THEN** the digest does not carry that decision in its not-reviewed list

#### Scenario: A non-carrying decision is not listed as not reviewed

- **WHEN** an open `question` or `hire_approval` is waiting and a digest is built
- **THEN** the digest does not carry it in its not-reviewed list

#### Scenario: The list is bounded

- **WHEN** more approvals are awaiting review than the list's fixed cap
- **THEN** the digest carries at most that many entries and does not grow without bound
