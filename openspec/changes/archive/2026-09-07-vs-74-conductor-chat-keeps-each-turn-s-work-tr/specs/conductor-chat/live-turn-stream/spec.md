## MODIFIED Requirements

### Requirement: The final reply is shown exactly once

The conductor's reply to the human is the outbound thread message it sends; that message is the durable record and SHALL remain the only place the reply text is shown once the turn is over. The live transcript SHALL NOT render the tool activity that delivers a reply to the human, so the reply never appears twice.

When the run finishes, the live transcript SHALL be replaced by that turn's trace section, collapsed — not by nothing. The replacement SHALL be continuous: the live block SHALL stay on screen until the row that takes its place is rendered, so the list does not lose and regain content while the thread reloads.

#### Scenario: Reply delivered mid-turn

- **WHEN** the conductor sends the human a message and then keeps working
- **THEN** the message appears once in the thread, and the tool activity that sent it does not appear in the live transcript

#### Scenario: Turn finishes

- **WHEN** the conductor's run finishes
- **THEN** the live transcript gives way to that turn's collapsed trace section, the reply text is shown only as the thread message, and the chat never shows a gap where the turn was
