# session-handover/command Specification

## Purpose
Defines when a worker offers a single, paste-ready command that resumes its session in a human's
own terminal on the daemon host, and when it offers none and states why instead.

## Requirements

### Requirement: A resumable worker offers one paste-ready resume command

For a worker whose runtime can resume a session and which has a stored session to resume, the system
SHALL offer a single command that, run in a shell on the daemon host, resumes that worker's session
in that worker's worktree. The command SHALL require no further steps or substitutions from the
human — no separate `cd`, no separate export, no placeholder left to fill in.

The command SHALL place the human in the same working context the daemon itself uses to take a turn
for that worker: the same working directory, and the same environment overlay (including any
variables a runtime's overlay requires, such as a redirected home or config directory). The command
SHALL resume the worker's actual stored session, not start a new one, and SHALL invoke the runtime
the same way the daemon's own resume of that session would.

#### Scenario: A resumable worker with a stored session offers a command

- **WHEN** a worker's runtime can resume a session and the worker has already taken at least one turn
- **THEN** the system offers one command that needs no edits before it is pasted

#### Scenario: The command reproduces the daemon's own working context

- **WHEN** the offered command is run in a shell on the daemon host
- **THEN** it lands the human in the same working directory and environment overlay the daemon uses
  for that worker, resuming the worker's actual stored session

### Requirement: The offered command states plainly where it lands

Because the working directory the command uses to reproduce the daemon's own context is not
necessarily the worker's git checkout itself, the system SHALL state, alongside the command, where it
lands and where the checkout is, in plain terms — not leave the human to infer it from the `cd`
target. This SHALL hold wherever the command is offered.

#### Scenario: The landing directory is named alongside the command

- **WHEN** the system offers a resume command
- **THEN** it also states which directory the command lands in and where the worker's checkout is,
  so a human who lands somewhere other than the checkout does not read it as a bug

### Requirement: An unresumable worker offers no command, and says why

The system SHALL NOT offer a resume command for a worker whose runtime cannot resume a session, and
SHALL NOT offer one for a worker that has no stored session yet (for instance, one that has not
completed a first turn). In both cases the system SHALL state plainly why no command is offered,
rather than staying silent or emitting a command that would fail.

#### Scenario: A runtime that cannot resume a session

- **WHEN** a worker's runtime does not support resuming a session
- **THEN** the system offers no command for that worker and states that the runtime cannot resume a
  session outside the daemon

#### Scenario: A worker with no session yet

- **WHEN** a worker has not yet completed a turn and has no stored session
- **THEN** the system offers no command for that worker and states that there is no session to
  resume yet

### Requirement: The command is offered wherever the need for it arises

The system SHALL offer the resume command on the worker itself, and on any open decision raised for
that worker, so that a human deciding "I need to do this myself" can act from the decision without
first navigating to the worker. Where the worker's runtime cannot resume a session, or the worker has
no stored session, the decision SHALL show the same stated reason rather than the command.

#### Scenario: The worker offers the command

- **WHEN** a human looks at a resumable worker with a stored session
- **THEN** they can get the resume command from the worker itself

#### Scenario: A decision raised for the worker offers the same command

- **WHEN** an open decision is raised for a resumable worker with a stored session
- **THEN** the decision offers the same resume command, without the human leaving that view

#### Scenario: A decision for an unresumable worker states the same reason

- **WHEN** an open decision is raised for a worker whose runtime cannot resume a session, or that has
  no stored session yet
- **THEN** the decision states the same reason the worker itself would, and offers no command
