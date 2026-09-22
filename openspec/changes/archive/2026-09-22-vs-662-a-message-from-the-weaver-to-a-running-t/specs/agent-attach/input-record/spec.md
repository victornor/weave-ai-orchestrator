## MODIFIED Requirements

### Requirement: What the human types appears in the agent's transcript

Text a human or the conductor sends to an agent SHALL be recorded as an event in the agent's run, carrying the text, who sent it, and which delivery occurred — mid-turn delivery, an interrupt, or queued delivery. It SHALL appear in the live view and in the stored transcript of that run, and SHALL therefore be visible to whatever can already read a run — including the conductor's inspection of that run. An input whose send interrupted the running turn SHALL be recorded and shown as an interrupt, and SHALL NOT be shown as queued.

#### Scenario: The transcript shows the human's message

- **WHEN** a human sends text to an agent
- **THEN** an entry appears in that run's transcript carrying the text, attributed to the human, and saying which delivery occurred

#### Scenario: An interrupting message is not recorded as queued

- **WHEN** a human's or the conductor's message interrupted the agent's running turn
- **THEN** its transcript entry records and shows an interrupt, not a queued delivery

#### Scenario: The conductor can see it afterwards

- **WHEN** the conductor inspects a run into which a human sent text
- **THEN** that text is in the transcript it receives