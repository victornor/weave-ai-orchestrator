## Purpose

A daemon-wide Scheduled page that lists every workspace's recurring conductor alarms, with each
task's fire history, reachable without picking a workspace first.

## ADDED Requirements

### Requirement: A global Scheduled page lists every workspace's routines

The web app SHALL provide an addressable Scheduled page at a path that does not include a workspace
id (`/scheduled`), reachable from the sidebar's global section and from the phone's More menu,
without typing a URL and without first choosing a workspace.

The page SHALL list every routine stored on any workspace this daemon hosts. Each row SHALL show
the workspace it belongs to, the routine's name, its schedule, its enabled state, when it was
created, when it next runs, and how many times it has fired. Opening the page SHALL NOT make a
workspace active and SHALL NOT rewrite the workspace remembered for the next launch.

There SHALL NOT be a Scheduled section on workspace settings. Per-workspace Chat, Needs you, Live,
Board and the rest SHALL keep working unchanged.

#### Scenario: Opening global Scheduled from the sidebar

- **WHEN** the human activates Scheduled in the sidebar's global section
- **THEN** the app shows the global Scheduled page without a document reload and without making a workspace the active one

#### Scenario: Opening global Scheduled from a phone

- **WHEN** the human opens More on a phone and chooses the global Scheduled destination
- **THEN** the app shows the global Scheduled page and the menu is dismissed

#### Scenario: Routines from two workspaces appear together

- **WHEN** workspace Alpha has one routine and workspace Beta has one, and the Scheduled page is open
- **THEN** the page shows both, and each row names its workspace

#### Scenario: A row shows schedule, next run, created-at and fire count

- **WHEN** a routine exists with a daily schedule, a next due time, a creation time, and two fires in its history
- **THEN** that row shows the schedule, the next due time, the creation time, and a fire count of two

#### Scenario: Workspace settings has no Scheduled section

- **WHEN** the workspace settings are shown
- **THEN** they do not offer a Scheduled tasks section

### Requirement: Each routine shows the history of what each fire did

Each routine on the page SHALL offer its individual fires, newest first. Each fire SHALL show when
it ran and what came of it: the conductor run's status, and the conductor's summary of that turn
when one was stored. When that run also handled work that was not this routine, the page SHALL say
so next to the summary, so the summary is not read as solely this fire's account. A fire whose run
has not finished SHALL still appear, with its in-flight status and without pretending a summary
exists. A routine that has never fired SHALL show a fire count of zero and no fire rows, not an
error.

History SHALL be the existing wake-to-run records for that routine. The page SHALL NOT require a
separate fire-history store.

#### Scenario: A completed fire shows when it ran and the summary

- **WHEN** a routine has a finished conductor run from one of its fires, and that run stored a summary
- **THEN** that fire appears on the routine with the time it ran, the run's status, and that summary

#### Scenario: An in-flight fire is listed without a summary

- **WHEN** a routine's latest fire has a conductor run that has not finished
- **THEN** that fire appears with an in-flight status and no summary is invented for it

#### Scenario: Never fired

- **WHEN** a routine has been created and has never fired
- **THEN** its fire count is zero and it shows no fire rows

#### Scenario: A shared-turn summary is labelled

- **WHEN** a fire's run also handled work that was not this routine
- **THEN** the page still shows that run's summary
- **AND** it says the run also handled other work

#### Scenario: A solo fire's summary is unlabelled

- **WHEN** a fire's run claimed only this routine
- **THEN** the page shows the summary without saying the run also handled other work

### Requirement: Captain can create and edit routines from the page

The page SHALL let captain create a routine on a chosen workspace, and SHALL let them edit, pause,
resume or remove an existing one. Creating SHALL name the workspace whose conductor the task will
wake; when the daemon hosts only one workspace, that workspace SHALL be the one used. Editing
SHALL be able to change the name, schedule, instruction and action policy, taking effect on the
next fire as `routines/definitions` already requires.

The conductor's own create/list/update/remove tools and the `conductor routine` CLI SHALL keep
working unchanged.

#### Scenario: Creating from the page on a chosen workspace

- **WHEN** captain adds a named daily routine from the Scheduled page and chooses workspace Alpha
- **THEN** Alpha stores that routine as active, and the page lists it under Alpha

#### Scenario: Creating with only one workspace

- **WHEN** the daemon hosts a single workspace and captain adds a routine from the Scheduled page
- **THEN** that workspace stores the routine, and captain is not asked to pick among workspaces

#### Scenario: Editing an existing routine

- **WHEN** captain changes a listed routine's instruction from the Scheduled page
- **THEN** the stored instruction is the new text
- **AND** the next fire carries that new text

#### Scenario: Pause and remove still work from the page

- **WHEN** captain pauses a routine from the Scheduled page, then removes another
- **THEN** the paused routine remains listed as paused and the removed one is no longer listed

### Requirement: Empty, loading and partial failure are explicit

While the workspace list has not yet loaded, the page SHALL show a loading state distinguishable
from empty. When every workspace has loaded and none has a routine, the page SHALL show a worded
empty state. A workspace that has no routines SHALL contribute no rows and SHALL NOT show an error
of its own. When one workspace's routines cannot be loaded, the page SHALL keep showing rows from
the workspaces that did load and SHALL show that the failed workspace could not load, with a way to
retry that workspace; it SHALL NOT blank the whole page. When the workspace list itself cannot be
loaded, the page SHALL show an error and a way to retry.

The page SHALL NOT open a persistent stream of its own. Live updates MAY arrive through the
existing global fan-in already mounted on daemon-level pages.

#### Scenario: Nobody has scheduled anything

- **WHEN** every hosted workspace has loaded and none has a routine
- **THEN** the page says so in words, with no rows

#### Scenario: One workspace is empty

- **WHEN** workspace Alpha has a routine and workspace Beta has none
- **THEN** the page shows Alpha's row and does not show an error for Beta

#### Scenario: One workspace fails to load

- **WHEN** workspace Alpha's routines fail to load and workspace Beta's have loaded with a routine
- **THEN** the page shows Beta's row, shows that Alpha could not load, and offers retry for Alpha

#### Scenario: The list is still loading

- **WHEN** the Scheduled page is open and the workspace list has not arrived
- **THEN** the page shows a loading state, not the empty state
