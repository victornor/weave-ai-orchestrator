## Purpose

The V2 Scheduled screen: every workspace's recurring tasks as the design's list, with each task's
scope — workspace and project — shown in the project's identity hue, and the create, edit, pause and
delete the app already supports kept working.

## ADDED Requirements

### Requirement: Scheduled lists every workspace's tasks with scope in the project's hue

`/v2/scheduled` SHALL list the routines of every workspace the daemon reports, each row showing the
task's name, its schedule, its workspace and project scope, and its next run and last result. The
project in a row's scope SHALL be rendered in that project's identity hue, the same hue the project
carries elsewhere; a task with no project SHALL render its scope without a project hue. A status
indicator SHALL reflect the task's last fire. The header SHALL state how many tasks are shown.

#### Scenario: A task with a project

- **WHEN** a scheduled task belongs to a project
- **THEN** its row shows the workspace and the project, with the project's name in that project's
  identity hue

#### Scenario: A task with no project

- **WHEN** a scheduled task names no project
- **THEN** its row shows the workspace scope without a project hue

#### Scenario: Tasks from several workspaces

- **WHEN** more than one workspace has scheduled tasks
- **THEN** the page lists them together and each row names its own workspace as its scope

### Requirement: A scheduled task can be created, edited, paused and deleted

The screen SHALL keep the create, edit, pause/resume and delete the app supports, each writing to
the existing routine endpoints for the task's own workspace. Expanding a task SHALL show its recent
fires and its recent spend, and the edit form for its name, schedule, timezone, instruction and
action.

#### Scenario: Creating a task

- **WHEN** the user fills the add form and submits
- **THEN** the task is created in the chosen workspace through the routine endpoint

#### Scenario: Editing a task

- **WHEN** the user changes a task's name, schedule, instruction or action and saves
- **THEN** the change is written to that task's workspace

#### Scenario: Pausing and resuming

- **WHEN** the user pauses an active task or resumes a paused one
- **THEN** the task's status is patched accordingly

#### Scenario: Deleting a task

- **WHEN** the user removes a task
- **THEN** it is deleted from its workspace and leaves the list

#### Scenario: Fire history and spend

- **WHEN** the user expands a task
- **THEN** its recent fires and its recent spend are shown
