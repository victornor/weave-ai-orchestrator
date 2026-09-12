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
for this reason back to work with the wake-ups they were holding — including the agent whose own
turn first discovered the outage, resuming on the same ticket it was working when it failed — SHALL
withdraw the decision it raised, and SHALL record that the credential is valid again.

None of that SHALL require the human to answer the decision, to resume a worker, or to act on any
worker individually. Answering the decision SHALL not be the mechanism by which the work resumes.

A worker stopped for this reason SHALL NOT be offered a resume that would simply fail again while
the runtime still needs a login.

#### Scenario: A restored login resumes everything

- **WHEN** the owner logs the runtime's CLI in again and the system's next check succeeds
- **THEN** the gate is cleared, every agent stopped for that outage takes its waiting turn, and the
  decision is withdrawn

#### Scenario: The agent that discovered the outage also resumes

- **WHEN** a runtime's login is restored after an agent's own turn was the one that first failed to
  authenticate on it
- **THEN** that agent also takes its waiting turn, on the same ticket it was working before it failed
- **AND** it does not have to be resumed by hand, and no work it had already reported is redone

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

### Requirement: A ticket whose worker pauses for an expired login tells the conductor

When an agent's turn fails because its runtime could not authenticate and that agent is working a
ticket, the system SHALL raise a decision owned by the conductor, attached to that ticket, saying
that the ticket's worker is paused for a runtime login outage and that it resumes on its own once the
login is restored. This SHALL use the same decision-raising path the system already uses to reach the
conductor for other findings, not a separate mechanism.

A second authentication failure on the same ticket while that decision is still open SHALL NOT raise
a second one.

The decision SHALL be withdrawn the next time that ticket's worker completes a turn, whether that
turn succeeds or fails for an unrelated reason, so the conductor is not left with a stale card once
the ticket is moving again or once a human has otherwise intervened.

This decision SHALL NOT be the per-worker decision the system raises when it will not retry a
failure by itself; it exists whether or not that failure is later resolved automatically, and does
not block the ticket.

#### Scenario: The conductor is told a ticket's worker paused

- **WHEN** a ticket's worker fails to authenticate and pauses for a runtime login outage
- **THEN** the conductor has an open decision naming that ticket and saying the worker is paused for
  a runtime login outage

#### Scenario: One card per ticket, not one per failure

- **WHEN** a ticket's worker fails to authenticate twice while the runtime is still gated
- **THEN** the conductor still has exactly one open decision about that ticket for this outage

#### Scenario: The card clears when the ticket moves again

- **WHEN** a ticket whose worker paused for a login outage later completes a turn
- **THEN** the decision raised for it is withdrawn

### Requirement: Repeated authentication failures on one worker are not resumed forever

When an agent's turn fails to authenticate for the third time in a row, with no successful turn
between the failures, the system SHALL NOT resume it automatically again when the runtime's login is
next restored. It SHALL instead raise the per-worker decision the system raises for a failure it will
not retry, naming the authentication failures, so a human decides what happens next.

This is a fact about the worker, not the runtime: a runtime confirmed healthy enough to release every
other agent, twice, while the same one keeps failing on it is no longer explained by the outage alone.

#### Scenario: A third consecutive authentication failure stops resuming

- **WHEN** one worker's turn fails to authenticate for the third time in a row with no successful
  turn in between
- **THEN** it is not resumed automatically the next time the runtime's login is restored
- **AND** a decision owned by the human is raised on its ticket naming the repeated failures

#### Scenario: A success in between resets the count

- **WHEN** a worker's turn fails to authenticate, then later succeeds, then fails to authenticate
  again
- **THEN** this is one consecutive failure, not two, and the worker keeps resuming automatically
