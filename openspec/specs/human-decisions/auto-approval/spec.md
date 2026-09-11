# human-decisions/auto-approval Specification

## Purpose
Defines YOLO mode: the setting that lets a workspace, or one project inside it, have its plan
approvals and merge approvals granted by the daemon instead of by the human — when each approval is
granted, how it is recorded so the history still says who approved what, which decisions the mode
must never touch, and how every surface that would otherwise offer an approve action reads while it
is on.

## Requirements

### Requirement: YOLO mode is a workspace setting a project can override

The workspace SHALL carry a setting, presented to the human as YOLO mode, that is either on or off
and is off unless it has been turned on. A project SHALL be able to override it in either direction,
and a project that has not set it SHALL follow the workspace.

The setting SHALL be readable and writable from the web app and from the CLI, and the value the
daemon acts on SHALL be the value those surfaces show.

Whether the mode is on for a given ticket SHALL be determined by that ticket's project, falling back
to the workspace when the project has not set it. A ticket with no project SHALL follow the
workspace.

#### Scenario: Off by default

- **WHEN** neither the workspace nor a project has set the mode
- **THEN** the mode is off, and every approval is put to the human exactly as it is without this feature

#### Scenario: On for the workspace

- **WHEN** the mode is turned on for the workspace and a project has not set it
- **THEN** tickets in that project are treated as having the mode on

#### Scenario: A project opts out

- **WHEN** the mode is on for the workspace and a project has turned it off
- **THEN** tickets in that project are treated as having the mode off, and tickets in every other project are unaffected

#### Scenario: A project opts in

- **WHEN** the mode is off for the workspace and a project has turned it on
- **THEN** tickets in that project are treated as having the mode on, and tickets in every other project are unaffected

#### Scenario: Changed from either surface

- **WHEN** the human turns the mode on or off from the web app or from the CLI
- **THEN** the setting is changed for the workspace or the project it was changed on, and both surfaces then report the new value

### Requirement: A plan approval is granted when the plan validates

While the mode is on for a ticket, the plan approval that a `change` ticket raises when its plan is
complete and validates SHALL be raised exactly as it is when the mode is off, and SHALL then be
granted by the daemon without waiting for the human. The ticket SHALL proceed to implementation by
the same path a human approval puts it on, including waking the worker.

The mode SHALL NOT change when the approval is raised, what it is raised for, or what happens after
it is granted. In particular it SHALL NOT cause a plan that does not validate to be approved.

#### Scenario: A plan validates while the mode is on

- **WHEN** a `change` ticket's plan is complete and validates and the mode is on for that ticket
- **THEN** a plan approval is raised and immediately granted, and the ticket moves on to implementation

#### Scenario: A plan does not validate

- **WHEN** a `change` ticket's plan is incomplete or fails validation and the mode is on
- **THEN** no approval is raised and no approval is granted; the ticket is not moved on

#### Scenario: The mode is off

- **WHEN** a `change` ticket's plan validates and the mode is off for that ticket
- **THEN** the plan approval is raised and waits for the human, as it does without this feature

### Requirement: A merge approval is granted when the work is ready to land

While the mode is on for a ticket, the merge approval raised when the worker delivers SHALL be
raised exactly as it is when the mode is off, and SHALL then wait until the delivered work is ready
to land before being granted by the daemon. Work is ready to land when the ticket's delivery is
complete and the project's own readiness condition for landing is met — for a pull-request delivery
whose project requires CI, that the pull request exists and its checks have passed.

While the work is not yet ready, the approval SHALL remain open and SHALL NOT be granted. Checks
that have failed SHALL NOT be treated as ready, and the ticket SHALL be told so rather than left
silent.

Once granted, the ticket SHALL land by the same path a human approval puts it on, including taking
its place in the project's merge queue and the verification that the branch actually landed. The
mode SHALL NOT bypass either.

#### Scenario: Checks pass

- **WHEN** a ticket's merge approval is open, the mode is on, and the delivered pull request's checks have passed
- **THEN** the approval is granted and the ticket enters the merge flow through the merge queue

#### Scenario: Checks are still running

- **WHEN** a ticket's merge approval is open, the mode is on, and the delivered pull request's checks have not finished
- **THEN** the approval stays open and is not granted

#### Scenario: Checks have failed

- **WHEN** a ticket's merge approval is open, the mode is on, and the delivered pull request's checks have failed
- **THEN** the approval stays open, is not granted, and the ticket records that the auto-approval is waiting on failing checks

#### Scenario: The project does not require checks

- **WHEN** a ticket's merge approval is open, the mode is on, and the project does not require checks before landing
- **THEN** the approval is granted without waiting for any check result

#### Scenario: The mode is off

- **WHEN** a ticket's merge approval is open and the mode is off for that ticket
- **THEN** the approval waits for the human however green the checks are

### Requirement: An auto-approval is recorded as the daemon's, naming the mode

An approval granted under this mode SHALL be recorded against the same decision the human would have
answered, as answered by the system rather than by a human, and its recorded answer SHALL name YOLO
mode as the reason it was granted.

Everything that follows an answer SHALL follow an auto-approval too: the decision is no longer open,
the agent that asked is woken with the answer, and the history shows the decision and its answer
where an approval given by the human would appear.

#### Scenario: The record of a granted plan approval

- **WHEN** a plan approval has been granted under this mode
- **THEN** the decision reads as answered by the system, with an answer that names YOLO mode, and it is no longer waiting

#### Scenario: The record of a granted merge approval

- **WHEN** a merge approval has been granted under this mode
- **THEN** the decision reads as answered by the system, with an answer that names YOLO mode, and it is no longer waiting

#### Scenario: The asker is told

- **WHEN** an approval raised by a worker is granted under this mode
- **THEN** that worker is woken with the answer exactly as it is when the human answers

### Requirement: No other decision is auto-approved

The mode SHALL apply to plan approvals and merge approvals only. Hire approvals, worktree discard
approvals, worker retry approvals, operational action approvals, gate findings and questions put to
the human SHALL keep their owners and SHALL still wait to be answered, whatever the mode is set to.

#### Scenario: A hire, a discard or a retry

- **WHEN** a hire approval, a discard approval or a retry approval is raised while the mode is on
- **THEN** it waits for the human and is not granted by the daemon

#### Scenario: A question

- **WHEN** an agent asks the human a question while the mode is on
- **THEN** the question waits for an answer and is not answered by the daemon

#### Scenario: An action approval

- **WHEN** an `action_approval` is raised on an `operational` ticket while the mode is on
- **THEN** it waits for the human and is not granted by the daemon

### Requirement: Turning the mode off stops what has not happened yet

Whether an approval is granted by the daemon SHALL be decided from the setting as it stands at the
moment the approval would be granted, not as it stood when the decision was raised.

Turning the mode off SHALL therefore stop the daemon granting any approval it has not already
granted, including one whose decision is already open and waiting. An approval that has already been
granted SHALL NOT be reversed, and a ticket already past that approval SHALL NOT be sent back.

#### Scenario: Turned off while a merge approval waits

- **WHEN** the mode is turned off while a merge approval that would have been auto-approved is still open
- **THEN** that approval is not granted by the daemon and waits for the human

#### Scenario: Turned off after an approval was granted

- **WHEN** the mode is turned off after an approval has already been granted under it
- **THEN** that approval stands, and the ticket continues from where the approval put it

#### Scenario: Turned on while a merge approval waits

- **WHEN** the mode is turned on while a merge approval is open and its work is ready to land
- **THEN** that approval is granted by the daemon

### Requirement: The mode is unmistakable wherever an approval would have been

While the mode is on, the web app SHALL show a persistent indicator that it is on, in a place the
human sees on every screen rather than only in settings.

A decision that the daemon will grant SHALL NOT be presented to the human as something to approve:
wherever an approve action would otherwise be offered for it, the surface SHALL instead say the
decision is auto-approved under this mode, and SHALL offer no approve action for it. A ticket whose
only open decision is one the daemon will grant SHALL NOT be presented as waiting on the human.

Decisions the mode does not cover SHALL be presented exactly as they are without it.

#### Scenario: The indicator

- **WHEN** the mode is on for the workspace
- **THEN** the web app shows a persistent indicator saying so, on every screen

#### Scenario: A merge approval that will be granted

- **WHEN** an open merge approval that the daemon will grant is shown to the human
- **THEN** the card says it is auto-approved under this mode and offers no approve action

#### Scenario: A ticket waiting only on an auto-approval

- **WHEN** a ticket's only open decision is one the daemon will grant
- **THEN** the board marks it as auto-approving rather than as waiting on the human

#### Scenario: A decision the mode does not cover

- **WHEN** a hire approval or a question is shown to the human while the mode is on
- **THEN** it is presented with its usual actions, unchanged

### Requirement: Agents are told the policy in force

The instructions the conductor works from and the brief a worker works from SHALL state whether
approvals are granted by the daemon for the work in hand, so that neither asks the human to approve
something that will be approved without them, and neither waits on a human who will never be asked.

#### Scenario: The conductor is told

- **WHEN** the conductor's instructions are built while the mode is on
- **THEN** they state that plan and merge approvals are granted automatically

#### Scenario: A worker is told

- **WHEN** a worker's brief is built for a ticket whose project has the mode on
- **THEN** it states that the plan and merge approvals for that ticket are granted automatically

#### Scenario: The mode is off

- **WHEN** the instructions or a brief are built while the mode is off for the work in hand
- **THEN** they state that those approvals wait for the human
