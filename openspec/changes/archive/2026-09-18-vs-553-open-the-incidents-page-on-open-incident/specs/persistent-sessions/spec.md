## ADDED Requirements

### Requirement: The session transcript names each message's author

On a persistent session's ticketless conversation surface, each message SHALL be attributed by who
authored it, not by which direction it travelled. A message the human sent SHALL read as `you`, on
every channel or device it arrived from. A message the session agent produced SHALL be labelled with
the agent's name — the role's name, which is what the human recognises — and never with a generic
`session`, `assistant` or `you`. A message another agent heard from the human and relayed, and a
system notice, SHALL each be labelled for what they are rather than falling back to `you` or to the
session agent's name. No message that is not from the human SHALL be labelled `you`.

#### Scenario: The agent's reply names the agent

- **WHEN** the session's conversation shows a message the session agent produced
- **THEN** it is labelled with the agent's role name, distinct from the human's messages

#### Scenario: The human's message reads as you

- **WHEN** the conversation shows a message the human sent, whatever channel or device it came from
- **THEN** it is labelled `you`

#### Scenario: A relayed message names its author

- **WHEN** the conversation shows a message the weaver relayed
- **THEN** it is labelled as the weaver's message, not as the human's and not as the session agent's

#### Scenario: A system notice is not attributed to the human

- **WHEN** the conversation shows a system-authored notice
- **THEN** it is labelled as a system notice, not `you`
