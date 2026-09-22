## Purpose

Defines what the conductor's own chat shows when one of its turns ends without an answer, and how an automatic retry of that turn is made visible — so a failed turn is legible in the conversation the human is reading rather than a silent gap that looks like an idle chat.

## ADDED Requirements

### Requirement: A conductor turn that ends without an answer states why

When a conductor's own turn ends without an answer — failed, timed out, cancelled or interrupted — the daemon SHALL post exactly one system-authored notice into the conductor's conversation naming a plain reason, with no run id and no error internals. It SHALL NOT post that notice while the turn is going to be retried or resumed by the daemon, nor when the turn already delivered an outbound reply of its own; in those cases the notice waits for the final outcome or is not needed.

The notice SHALL be published to the conversation the human reads for that turn — the thread that woke it when the turn came from one, otherwise the conductor's primary human thread — and SHALL NOT be posted into a thread the conductor does not own.

A notice for a stopped turn SHALL say the turn was stopped before it could answer. A notice for a turn stopped by the runtime's usage limit SHALL name the limit, give the reset instant when the runtime reported one, and say that nothing retries it automatically. An authentication outage SHALL keep its existing runtime-wide login announcement and SHALL NOT also produce a per-turn notice here, so the human is told once.

A chat surface SHALL render a `system`-authored message as a notice — centred, muted and attributed to the system — and SHALL NOT render it as a message from the weaver or the human.

#### Scenario: A failed adapter turn says why

- **WHEN** a conductor turn fails with an adapter error and no retry is scheduled for it
- **THEN** the conductor's conversation shows exactly one system notice naming the plain reason, with no run id

#### Scenario: A stopped turn says why

- **WHEN** a conductor turn times out, is cancelled, or is interrupted
- **THEN** the conversation shows a system notice that the turn was stopped before it could answer

#### Scenario: A usage-limit turn gives the reset and the next step

- **WHEN** a conductor turn is stopped by the runtime's usage limit, with or without a reset the runtime reported
- **THEN** the notice names the usage limit, gives the reset when there is one, and says that nothing retries it automatically

#### Scenario: A turn that answered is not also told it failed

- **WHEN** a conductor turn sent the human a reply and then ended in failure
- **THEN** no second system notice is posted for that turn

#### Scenario: A turn that will be retried is not announced early

- **WHEN** a conductor turn fails with retries still to come
- **THEN** no system notice is posted for that attempt

#### Scenario: The notice renders as a system notice

- **WHEN** the conductor's chat renders a `system`-authored message
- **THEN** it is centred, muted and attributed to the system, not shown as a weaver reply

### Requirement: An automatic retry is visible without a message per attempt

While a failed conductor turn has an automatic retry scheduled, the chat SHALL show that the turn failed and that recovery is in progress, derived from the run's own recorded retry instant, so the state is still shown after a reload while the retry is pending. It SHALL NOT post a failure notice for each attempt, and the retrying state SHALL NOT be persisted as a thread message, so a transient blip that a retry resolves leaves no failure text in the conversation. The retrying state SHALL clear once a later attempt runs or nothing is scheduled.

#### Scenario: The first retryable failure is shown without a notice

- **WHEN** a conductor turn fails transiently and a retry is scheduled
- **THEN** no system notice is posted for the attempt, and the chat shows that the turn is being retried

#### Scenario: A resolved-on-retry blip spams nothing

- **WHEN** a conductor turn fails and the scheduled retry then succeeds
- **THEN** the conversation holds the retry's answer and no failure notice for the failed attempt

#### Scenario: A sustained outage is not narrated per attempt

- **WHEN** every automatic attempt of a conductor turn fails and the ladder is spent
- **THEN** no notice is posted per attempt, and exactly one terminal notice is posted when the retries are exhausted

#### Scenario: A reload during a retry still shows it

- **WHEN** the chat is reloaded while a retry of a failed conductor turn is pending
- **THEN** the chat still shows that the turn is being retried
