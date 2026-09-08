# daemon-isolation/dispatch-gate Specification

## Purpose
Defines when a daemon does not autonomously turn a queued wake into a spawned coding-CLI run, so
that standing up an isolated daemon and exercising it — including adding a project — cannot spend a
real turn without a human asking for it directly.

## Requirements

### Requirement: An isolated daemon only dispatches a run a human explicitly asked for

An isolated daemon (per `daemon-isolation/credential-scope`) SHALL dispatch a run for an agent's
queued wake only when at least one of the wake-ups it would claim was requested by a human — directly,
such as sending a chat message or answering a decision, not as a side effect the system produced on
its own.

A wake requested by the system or by another agent — including the wake a project add produces for
the conductor, and the wake a ticket assignment produces for a worker — SHALL stay queued rather than
be dispatched, until a human-requested wake for that same agent makes it eligible, or a human
dispatches it some other explicit way.

When several wake-ups for one agent have coalesced into one queued entry, the presence of a
human-requested one anywhere in that entry SHALL be enough to make the whole entry eligible: an
isolated daemon SHALL NOT lose or re-order queued work in order to withhold it, only delay dispatching
it.

This SHALL NOT change how or when a wake is enqueued, how a ticket or job is created, or any other
part of the system's behavior: only the step that turns eligible queued wakes into a spawned run is
gated, and only for wakes that are not eligible.

#### Scenario: A system-requested wake queues but does not run

- **WHEN** an isolated daemon enqueues a wake requested by the system or by an agent, with no
  human-requested wake queued for that same agent
- **THEN** the wake is recorded as queued and no run is spawned for it

#### Scenario: Adding a project does not dispatch its scout ticket or the conductor

- **WHEN** a project is added to an isolated daemon
- **THEN** the scout ticket describing the project is created as usual, and neither the conductor's
  wake about the new project nor a later assignment of that ticket to a worker is dispatched on its
  own

#### Scenario: A human message makes the conductor's queued work eligible

- **WHEN** a human sends the conductor a chat message on an isolated daemon while other, system- or
  agent-requested wakes are already queued for it
- **THEN** a run is dispatched for the conductor, and that run's wake-ups include the ones already
  queued alongside the human's message

#### Scenario: A non-isolated daemon is unaffected

- **WHEN** a wake is enqueued for an agent in a daemon that is not isolated
- **THEN** it is claimed and dispatched exactly as it is today, regardless of who requested it

### Requirement: Sharing host credentials also enables autonomous dispatch

An isolated daemon that has been given the explicit credential-sharing opt-in of
`daemon-isolation/credential-scope` SHALL also dispatch autonomously, exactly as a non-isolated
daemon does. The two behaviors — credential sharing and autonomous dispatch — SHALL be governed by
the same isolation state, so an operator who deliberately wants a second real daemon on the host does
not have to reason about two separate switches.

#### Scenario: The sharing opt-in also restores autonomous dispatch

- **WHEN** an isolated daemon starts with the credential-sharing opt-in given
- **THEN** wakes are claimed and dispatched regardless of who requested them, without a separate
  dispatch opt-in
