# web-v2/roles Specification

## Purpose
The V2 Roles screen at `/v2/w/<workspace>/roles`: every role hired for a project, grouped by
project, with its state, worker count and charter; a working worker's shared live feed expanding in
place; the Hire a role modal that formats a request the weaver recognises; and the role management
V1 has, restyled to the V2 language.

## Requirements

### Requirement: Roles are grouped by project with their state, worker count and charter

The V2 Roles screen SHALL list the workspace's hired roles grouped under their project, in a stable
project order. Each role SHALL show its name, its state, its live worker count against its worker
cap, and its charter summary. A role whose status is `pending_activation` SHALL read **awaiting hire
approval**. The header count of roles SHALL be derived from the same list the screen renders.

#### Scenario: Roles are grouped by project

- **WHEN** two projects each have hired roles
- **THEN** each role is listed under its own project's group and no role appears under another
  project

#### Scenario: A role shows its state, count and charter

- **WHEN** a role is active with two of its four workers live
- **THEN** its row shows the role name, an active state, `2/4` (or `2 workers` with the cap), and
  its charter summary

#### Scenario: Awaiting hire approval is named

- **WHEN** a role's status is `pending_activation`
- **THEN** its state reads **awaiting hire approval** rather than the raw status

#### Scenario: A project with no roles

- **WHEN** a project has no hired roles
- **THEN** its group is shown with an explicit "no role hired yet" message

### Requirement: A working worker expands its shared live feed in place

For a worker with a live session (a run is running or queued), activating its row SHALL expand the
shared V2 worker feed in place beneath the row, and activating it again SHALL collapse it. The
expanded feed SHALL be the same `v2/WorkerFeed` component VS-345 ships, headed by the worker's model
and ticket title, and footed by its spend and an **Open in Live** link. Expansion state SHALL be
held per worker, so expanding one does not expand another. A worker with no live session SHALL NOT
expand a feed and SHALL keep the existing behaviour of opening the worker page.

#### Scenario: A working worker's feed expands in place

- **WHEN** the human activates a worker that has a run in progress
- **THEN** the worker's compact live feed appears in place under its row and the control offers to
  collapse it again

#### Scenario: Two workers expand independently

- **WHEN** the human expands the feed on one of two working workers
- **THEN** only that worker's feed is expanded and the other stays collapsed

#### Scenario: A worker with no live session opens its page

- **WHEN** the human activates a worker that has no run in progress
- **THEN** no feed expands and the worker page opens instead

#### Scenario: The expanded feed names model, ticket, spend and Live

- **WHEN** a working worker's feed is expanded
- **THEN** it shows the run's model and the worker's ticket title above the trace, and its spend
  and an **Open in Live** link below it

### Requirement: The hire modal previews exactly the message it sends

The Hire a role modal SHALL offer a picker of the workspace's projects and a free-text field for
what the role should own. It SHALL render a live preview of the exact message the weaver receives,
built as `/hire-role project=<project slug>` followed by a blank line and the description text. On
send, the same built message SHALL be posted to the workspace weaver's chat thread through the
existing thread-message endpoint, and SHALL be the only body sent. The modal SHALL state in its
footer that the charter comes back for approval.

#### Scenario: The preview is the message

- **WHEN** the human picks a project and types a description
- **THEN** the preview shows `/hire-role project=<slug>` followed by the description, and the same
  string is what the send posts to the thread-message endpoint

#### Scenario: The message lands in the weaver chat

- **WHEN** the human sends the hire request
- **THEN** the endpoint is called on the thread the chat screen would open — the workspace's default
  web thread — with the built body, and a thread is created only when the workspace has none

#### Scenario: The footer promises approval

- **WHEN** the modal is open
- **THEN** it states that the human will approve the charter before any worker runs

### Requirement: The kept role management actions work in V2

The V2 Roles screen SHALL keep V1's role management, using the existing roles endpoints: pause,
resume and retire a role; edit a role's charter with its revision history and roll back to an earlier
revision; change a role's max workers; and start an interactive session against a role. Pause,
resume, retire, charter edit and max workers SHALL each reach their existing route. A failed update
SHALL be shown rather than silently swallowed.

#### Scenario: Pause, resume and retire

- **WHEN** the human pauses an active role, resumes a paused one, or retires a role
- **THEN** the corresponding role action is called and the role's state reflects the result

#### Scenario: Charter edit and rollback

- **WHEN** the human edits a charter with a reason and saves, or rolls back to an earlier revision
- **THEN** the charter update or rollback is called and the role's revisions are shown

#### Scenario: Max workers

- **WHEN** the human changes a role's max workers
- **THEN** the role PATCH is called with the new `maxWorkers` and the role's cap updates

#### Scenario: Start session

- **WHEN** the human starts a session against a role
- **THEN** a session is created for that project and role and its worker page opens
