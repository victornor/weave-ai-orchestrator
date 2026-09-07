## ADDED Requirements

### Requirement: A live-input send refuses an agent that has retired

The system SHALL refuse to send text to an agent that has retired, with a clear error naming that it
has retired, rather than recording the text and queuing it for a turn that will never happen.

#### Scenario: Sending to a retired agent

- **WHEN** a human or the conductor sends text to an agent that has already retired
- **THEN** the send is refused with a clear reason, and nothing is recorded as delivered or queued

#### Scenario: A live agent is unaffected

- **WHEN** a human or the conductor sends text to an agent that has not retired
- **THEN** the send proceeds exactly as it does today, mid-turn or queued
