## ADDED Requirements

### Requirement: An approval awaiting the weaver's review stays visible on Needs you

An open human-owned `plan_approval`, `merge_approval` or `action_approval` whose review state is **not
looked at yet** SHALL remain listed on the V2 Needs you screen as a card that reads as waiting on the
weaver's review, and SHALL NOT be omitted from the list because of its review state. The card SHALL
not present as a plain approvable card: its approving action SHALL remain withheld and its override
offered, as the decision card already does.

The screen's actionable Needs-you signal (the shell/rail count) SHALL continue to exclude a card
awaiting review while it is **not looked at yet**, and SHALL include it once the weaver marks it
**looked at** or **looked at, with concerns** (VS-411). Excluding it from that count SHALL NOT remove
its card from the list.

#### Scenario: An unseen approval is listed but not counted

- **WHEN** a workspace has one open human-owned `merge_approval` whose review state is **not looked at
  yet** and no other open decision
- **THEN** the V2 Needs you screen lists its card with the waiting-on-review state, while the
  actionable Needs-you count is zero

#### Scenario: A clean mark counts the card

- **WHEN** the weaver marks that merge approval **looked at** with no concerns
- **THEN** the actionable Needs-you count includes the card, and its card reads as reviewed

#### Scenario: A reviewed-with-concerns card is counted and held

- **WHEN** the weaver marks the approval **looked at, with concerns**
- **THEN** the actionable Needs-you count includes the card and its card shows the held state
