## Purpose
Defines what it means for a human to attach to a running agent: seeing everything the agent is doing
as it happens, joining a turn that is already under way, and leaving again without the agent noticing
— so that watching an agent is never something the agent's progress depends on.

## ADDED Requirements

### Requirement: A human can attach to a running agent and see its activity as it happens

The system SHALL let a human attach to any agent that is executing a run and observe that run's
activity as it is recorded: assistant text, tool calls with their results, file changes, errors and
the run's lifecycle. Activity SHALL reach an attached view over the system's live event stream, with
no delay beyond that stream's own, and SHALL NOT require the view to poll.

Attaching SHALL be available from the worker's page and from the surface that inspects a run.

#### Scenario: Attaching to a working agent

- **WHEN** a human attaches to an agent whose run is executing
- **THEN** the activity that run produces from that moment on appears in the attached view as it is
  recorded, without the view polling for it

#### Scenario: Assistant text and tool calls both arrive

- **WHEN** the attached run produces assistant text and then makes a tool call that returns a result
- **THEN** the attached view shows the text, the call and its outcome

### Requirement: Attaching mid-turn shows the turn's activity so far

When a human attaches to a run that is already under way, the view SHALL show the activity that run
has already produced before continuing with the rest of it, rather than starting from an empty
screen. When the live connection drops and is re-established, the view SHALL resume without losing
activity produced while it was disconnected and without repeating activity it already showed.

#### Scenario: Attaching to a turn already in progress

- **WHEN** a human attaches to an agent that has been working for some time
- **THEN** the view shows the activity produced so far and then continues with new activity

#### Scenario: The connection drops and returns

- **WHEN** the live connection of an attached view drops and is re-established during the same run
- **THEN** activity produced while it was disconnected is shown, and activity already shown is not
  duplicated

### Requirement: Attaching to an agent that is not running is not an error

The system SHALL let a human attach to an agent between turns. In that case the view SHALL show the
agent's most recent run rather than failing or showing nothing, and SHALL switch to the next run
when one starts.

#### Scenario: Attaching between turns

- **WHEN** a human attaches to an agent that has no run executing
- **THEN** the view shows that agent's most recent run and reports that no turn is under way

#### Scenario: A new turn begins while attached

- **WHEN** the agent starts a new run while a human is attached
- **THEN** the view follows that new run

### Requirement: Nothing about a run depends on someone watching it

A run SHALL execute identically whether or not a human is attached. Attaching SHALL NOT change the
run's inputs, its pace, its permissions or its outcome, and SHALL NOT be recorded as a change to the
agent or its ticket. Detaching — closing the view, or losing the connection — SHALL leave the run
executing normally, and SHALL NOT cancel, pause or interrupt it.

The system SHALL NOT require an attached watcher in order to accept input for the agent, and SHALL
NOT hold a run open waiting for one.

#### Scenario: Detaching mid-turn

- **WHEN** a human closes an attached view while the agent's run is executing
- **THEN** the run continues to completion exactly as it would have, and its recorded result is
  unchanged

#### Scenario: The connection is lost rather than closed

- **WHEN** an attached view's connection is lost without being closed
- **THEN** the run is unaffected and no cancellation, pause or interruption is recorded

#### Scenario: Attaching changes nothing

- **WHEN** a human attaches to a run and then detaches without sending anything
- **THEN** the run's recorded events, status and result are the same as for an identical run nobody
  attached to
