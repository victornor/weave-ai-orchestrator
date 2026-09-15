## ADDED Requirements

### Requirement: A ticket whose approval is waiting on the weaver shows that state

When the ticket page renders a ticket whose status is `in_review` or `proposed` and whose live open
approval decision is of a review-carrying kind (`plan_approval`, `merge_approval`, `action_approval`)
whose review state is **not looked at yet**, the page SHALL show that the ticket is waiting on the
weaver's review, in the same terms the decision card uses, and SHALL NOT present the ticket as waiting
on the human alone. The page SHALL still render the decision card with its waiting state, and the
card's approving action SHALL remain withheld. The waiting state SHALL be derived from the ticket's
own open decisions rather than from the ticket's status alone.

Once the weaver marks the decision **looked at**, or the decision is answered, superseded, withdrawn
or expired, the page SHALL stop showing the waiting-on-review state and revert to its ordinary ticket
status. A ticket with no open review-carrying decision, and a ticket with no such decision at all,
SHALL show no waiting-on-review state.

#### Scenario: An in-review ticket with an unseen merge approval says it waits on the weaver

- **WHEN** an `in_review` ticket's live open `merge_approval` is **not looked at yet**
- **THEN** the ticket page shows that it is waiting on the weaver's review, and its merge card still
  shows the waiting state with its approving action withheld

#### Scenario: A clean mark clears the waiting state

- **WHEN** the weaver marks that merge approval **looked at** with no concerns
- **THEN** the ticket page no longer shows the waiting-on-review state

#### Scenario: An answered approval shows no waiting state

- **WHEN** the ticket's approval decision has been answered
- **THEN** the ticket page shows no waiting-on-review state for it

#### Scenario: A proposed ticket with a held plan reads the same way

- **WHEN** a `proposed` ticket's live open `plan_approval` is **not looked at yet**
- **THEN** the ticket page shows that it is waiting on the weaver's review
