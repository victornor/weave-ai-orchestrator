## MODIFIED Requirements

### Requirement: The first authentication failure stops the runtime

When an agent's turn fails because the runtime could not authenticate, the system SHALL record that
runtime's credential as needing a login, and SHALL stop starting turns for every agent on that
runtime in that workspace.

An agent's own turn reporting that it could not authenticate is the only trigger for this behavior.
The system SHALL NOT perform any check or probe of its own, ahead of or separate from a turn, in
order to decide whether a runtime needs a login.

It SHALL do so on the first such failure. It SHALL NOT retry the turn automatically and SHALL NOT
wait for further agents to fail before stopping.

An agent that cannot be started for this reason SHALL keep the work it was woken for: its pending
wake-ups SHALL be preserved, not discarded, so that nothing is lost and nothing has to be re-asked.
The agent whose own turn failed and revealed the outage SHALL keep its work the same way: the
wake-up that turn was answering SHALL be preserved rather than recorded as failed, exactly as if it
had never been claimed, so that this agent resumes on the same footing as every other agent the
outage stops. Recording it as failed SHALL NOT be treated as the ordinary outcome of an authentication
failure, because unlike every other outcome a turn can have, this one is not a fact about the turn.

Agents on other runtimes SHALL be unaffected and SHALL keep running.

#### Scenario: One failure gates the runtime

- **WHEN** one agent's turn fails because its runtime could not authenticate
- **THEN** the runtime's credential is recorded as needing a login
- **AND** no further turn is started for any agent on that runtime

#### Scenario: Nothing is spent re-failing

- **WHEN** several agents on a gated runtime have work waiting
- **THEN** no turn is started for any of them, and no further authentication failure is produced

#### Scenario: Pending work is kept

- **WHEN** an agent is stopped because its runtime needs a login
- **THEN** the wake-ups it had waiting are still waiting afterwards

#### Scenario: The agent that discovered the outage keeps its own work too

- **WHEN** an agent's turn fails because its runtime could not authenticate
- **THEN** the wake-up that turn was answering is preserved, not recorded as failed
- **AND** it is waiting, unchanged, for that agent once the runtime's login is restored

#### Scenario: Another runtime keeps working

- **WHEN** one runtime needs a login and an agent on a different runtime has work waiting
- **THEN** that agent takes its turn normally

#### Scenario: A credential that has not yet been used this turn is not pre-judged

- **WHEN** an agent's turn is about to be spawned on a runtime whose credential file, read on disk,
  would not be confirmed valid for the turn's full expected duration
- **THEN** the turn spawns anyway, exactly as it would if the credential were fresh
- **AND** the runtime is only gated if that turn's own attempt then fails to authenticate
