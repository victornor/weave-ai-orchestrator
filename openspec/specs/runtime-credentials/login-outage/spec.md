# runtime-credentials/login-outage Specification

## Purpose
Defines how the system reacts when a runtime's login has expired and cannot be refreshed: it stops
that runtime once rather than failing every agent in turn, tells the human exactly once and by a
path the outage itself cannot block, and puts every waiting agent back to work by itself once the
login is restored.

## Requirements

### Requirement: The first authentication failure stops the runtime

When an agent's turn fails because the runtime could not authenticate, the system SHALL record that
runtime's credential as needing a login, and SHALL stop starting turns for every agent on that
runtime in that workspace.

It SHALL do so on the first such failure. It SHALL NOT retry the turn automatically and SHALL NOT
wait for further agents to fail before stopping.

An agent that cannot be started for this reason SHALL keep the work it was woken for: its pending
wake-ups SHALL be preserved, not discarded, so that nothing is lost and nothing has to be re-asked.

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

#### Scenario: Another runtime keeps working

- **WHEN** one runtime needs a login and an agent on a different runtime has work waiting
- **THEN** that agent takes its turn normally

### Requirement: One outage raises exactly one decision

A runtime that needs a login SHALL raise exactly one open decision owned by the human, naming the
runtime and telling the human what to do — to log that runtime's CLI in again, and that the work
resumes once they have.

Further authentication failures on the same runtime while that decision is open SHALL join it: the
system SHALL NOT raise a second card, and SHALL NOT raise a card per agent or per ticket.

The system SHALL NOT raise the per-worker decision it raises for a failure it will not retry.

The decision SHALL NOT contain the credential, the token, or any part of either.

#### Scenario: One card, not one per worker

- **WHEN** three agents on the same runtime would each have failed to authenticate
- **THEN** the human has exactly one open decision about that runtime
- **AND** no per-worker retry decision is raised for any of them

#### Scenario: A second failure joins the open card

- **WHEN** another authentication failure occurs on a runtime whose decision is already open
- **THEN** the human still has exactly one open decision about that runtime

#### Scenario: The card says what to do

- **WHEN** the decision for an expired login is shown
- **THEN** it names the runtime and tells the human to log its CLI in again, and says the work
  resumes on its own afterwards

#### Scenario: No secret on the card

- **WHEN** the decision for an expired login is shown or stored
- **THEN** it contains no token and no part of the credential

### Requirement: The human is told over the channel, not through the conductor

The system SHALL deliver the news of an expired login to the human through the channel path it uses
to reach the human directly, and SHALL NOT depend on the conductor taking a turn in order to report
it.

This SHALL hold when the conductor itself is on the affected runtime and therefore cannot take a
turn. An outage SHALL NOT be able to hide behind an agent that the same outage has stopped.

#### Scenario: The conductor is on the affected runtime

- **WHEN** a runtime needs a login and the conductor runs on that same runtime
- **THEN** the human is still told about the outage
- **AND** the message reaches them without the conductor having taken a turn

#### Scenario: No conductor turn is required

- **WHEN** the news of an expired login is delivered
- **THEN** it is delivered over the channel path, not produced by a conductor run

### Requirement: The work resumes by itself when the login is restored

While a runtime needs a login, the system SHALL check on its own whether that runtime's credential
works again, without a human telling it to.

When a check succeeds, the system SHALL clear the runtime's gate, SHALL put every agent it stopped
for this reason back to work with the wake-ups they were holding, SHALL withdraw the decision it
raised, and SHALL record that the credential is valid again.

None of that SHALL require the human to answer the decision, to resume a worker, or to act on any
worker individually. Answering the decision SHALL not be the mechanism by which the work resumes.

A worker stopped for this reason SHALL NOT be offered a resume that would simply fail again while
the runtime still needs a login.

#### Scenario: A restored login resumes everything

- **WHEN** the owner logs the runtime's CLI in again and the system's next check succeeds
- **THEN** the gate is cleared, every agent stopped for that outage takes its waiting turn, and the
  decision is withdrawn

#### Scenario: No per-worker action is needed

- **WHEN** several workers were stopped by one expired login and the login is restored
- **THEN** all of them resume without the human resuming any of them individually

#### Scenario: The check keeps failing

- **WHEN** the login has not been restored
- **THEN** the runtime stays gated, the decision stays open, and no turn is started

#### Scenario: Resume is not offered into a failure

- **WHEN** a worker stopped by an expired login is shown while the runtime still needs a login
- **THEN** it is not offered a resume that would start a turn on that runtime

### Requirement: A worker stopped by an expired login says so

A worker the system stopped because its runtime needs a login SHALL record that as its reason,
distinguishable from a worker that failed on its own and from a worker a human paused.

Every surface that shows a stopped worker SHALL name that reason, and SHALL point at the one open
decision for the runtime rather than presenting the worker as individually broken.

#### Scenario: The worker's reason names the login

- **WHEN** a worker stopped by an expired login is read
- **THEN** its recorded reason names the runtime's expired login

#### Scenario: The ticket is not presented as the worker's fault

- **WHEN** a ticket whose worker was stopped by an expired login is shown
- **THEN** it names the runtime's expired login as the reason and points at the one open decision
