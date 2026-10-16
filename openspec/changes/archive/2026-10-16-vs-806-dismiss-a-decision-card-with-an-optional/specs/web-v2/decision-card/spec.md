## ADDED Requirements

### Requirement: An agent-raised card can be dismissed with an optional reason

An open `question`, `concern` or `gate_finding` card SHALL offer a **Dismiss…** control. It SHALL open
an optional reason field with a confirming **Dismiss** action and a Cancel, and confirming SHALL
dismiss the decision with the reason when one was typed and without one when not. The reason SHALL NOT
be required. The card SHALL say the weaver is told it was dismissed. Cards of every other kind SHALL
offer no Dismiss control, and a card that is not open SHALL offer none. Dismissing SHALL remove the
card from Needs you and the chat pane as an answer does.

#### Scenario: Dismiss with a reason

- **WHEN** the human opens Dismiss on an open question, types "wrong project" and confirms
- **THEN** the decision is dismissed with the reason "wrong project"

#### Scenario: Dismiss without a reason

- **WHEN** the human opens Dismiss and confirms without typing
- **THEN** the decision is dismissed with no reason, and nothing blocks the action

#### Scenario: No Dismiss on a system approval

- **WHEN** a `merge_approval` card is rendered
- **THEN** it offers no Dismiss control

#### Scenario: Cancel

- **WHEN** the human opens Dismiss and cancels
- **THEN** nothing is sent and the card is unchanged
