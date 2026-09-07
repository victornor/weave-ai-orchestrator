## Purpose
Describes the web app's per-project overview: the one page that answers "what is happening in this
project?" by gathering that project's tickets, workers, landings, merge queue, changelog and
knowledge in one place, how it is addressed and reached, and how it stays current.

## ADDED Requirements

### Requirement: A project has an overview page of its own

The web app SHALL have a page per project, addressed within the workspace by the project's slug, and
SHALL also accept the project's id at the same address so a link built from either form resolves.

The page SHALL show data for that project alone. A ticket, worker, decision, landing, changelog
entry or knowledge file belonging to another project, or to no project, SHALL NOT appear on it.

An address naming a project the workspace does not have SHALL show that the project was not found,
offer the way back to the workspace, and SHALL NOT report a failed request.

#### Scenario: Opening a project by slug

- **WHEN** the overview is opened at a project's slug
- **THEN** that project's overview is shown

#### Scenario: Opening a project by id

- **WHEN** the overview is opened at a project's id instead of its slug
- **THEN** the same project's overview is shown

#### Scenario: Another project's work is not shown

- **WHEN** the workspace has two projects with tickets, workers and changelog entries in each
- **THEN** one project's overview shows only its own, in every section

#### Scenario: A project that does not exist

- **WHEN** the overview is opened for a name no project in the workspace has
- **THEN** the page says the project was not found and offers a way back, and no error state about a
  failed request is shown

### Requirement: The overview states what the project is

The overview SHALL open with the project's name, the repository it is cloned from, its default
branch and the delivery mode in force for it — the project's own setting where it has one, and
otherwise the workspace default, marked as inherited.

It SHALL also show the project's Current focus as written in that project's knowledge file. A
project whose knowledge file has no Current focus section, or whose knowledge file cannot be read,
SHALL simply omit it; nothing SHALL be invented in its place.

#### Scenario: The header

- **WHEN** a project's overview is shown
- **THEN** its name, its repository, its default branch and its delivery mode are shown

#### Scenario: Delivery mode is inherited

- **WHEN** the project sets no delivery mode of its own
- **THEN** the workspace default is shown and is marked as inherited

#### Scenario: Current focus

- **WHEN** the project's knowledge file has a Current focus section
- **THEN** its content is shown in the header

#### Scenario: No Current focus written

- **WHEN** the project's knowledge file has no Current focus section
- **THEN** no Current focus is shown and no placeholder text stands in for it

### Requirement: The overview keeps the project's other views one click away

The overview SHALL link to that project's board, its merge queue, its knowledge, its specs and the
conductor chat, each reachable in one activation from the page, and each arriving already scoped to
that project where the destination can be scoped.

#### Scenario: To the board

- **WHEN** the board link is activated from a project's overview
- **THEN** the board opens filtered to that project

#### Scenario: To the merge queue

- **WHEN** the merge-queue link is activated from a project's overview
- **THEN** the merge queue opens showing that project

#### Scenario: To the knowledge area

- **WHEN** the knowledge link is activated from a project's overview
- **THEN** the knowledge area opens with that project selected

### Requirement: The overview shows what needs the human and what is under way

The overview SHALL show the decisions waiting on the human that belong to that project, each naming
its ticket and opening it. When none are open the section SHALL say so rather than being hidden.

It SHALL show the project's tickets that are not finished, folded by status, and for a ticket a
worker is currently on it SHALL name that worker and show that worker's most recent status line.
A ticket with no live worker SHALL NOT be given one, and a worker with nothing to report SHALL
simply have no line.

#### Scenario: A decision is waiting

- **WHEN** a ticket in the project has an open decision owned by the human
- **THEN** it is listed in the overview's needs-you section and opens that ticket

#### Scenario: Another project's decision

- **WHEN** the only open decision belongs to a ticket in another project
- **THEN** this project's overview shows none waiting

#### Scenario: Work with a worker on it

- **WHEN** a ticket in the project has a live worker whose last turn reported a status line
- **THEN** the ticket is shown under its status with that worker's name and that line

#### Scenario: Work with no worker

- **WHEN** a ticket in the project has no live worker
- **THEN** the ticket is shown under its status with no worker named

### Requirement: The overview shows what is landing and what has landed

The overview SHALL show the project's merge queue: what is merging now and what is waiting behind
it, in order.

It SHALL separately show what landed in the project over the last 14 days, newest first, each
landing naming its ticket and opening it, and carrying a link to the pull request where one was
recorded for that ticket. A landing with no recorded pull request SHALL be listed without one. When
nothing landed in that window the section SHALL say so.

#### Scenario: Something is merging

- **WHEN** a ticket of the project is in its merge queue
- **THEN** the overview shows it as landing, and anything queued behind it in order

#### Scenario: A landing with a pull request

- **WHEN** a ticket landed in the last 14 days and a pull request was recorded for it
- **THEN** it is listed with a link to that pull request and a link to the ticket

#### Scenario: A landing without a pull request

- **WHEN** a ticket landed in the last 14 days with no pull request recorded
- **THEN** it is listed with its ticket link and no pull-request link

#### Scenario: A quiet fortnight

- **WHEN** nothing landed in the project in the last 14 days
- **THEN** the section says so instead of showing an empty list

### Requirement: The overview shows the project's activity and its knowledge

The overview SHALL show the project's changelog: the activity heatmap over the past year and the
newest entries beneath it, the same record the workspace's Changelog view shows, narrowed to this
project.

It SHALL show the project's knowledge: the sections of the project's knowledge file with how much of
its budget it uses, and the project's linked documents, each opening the page that already shows it.

#### Scenario: Activity

- **WHEN** a project's overview is shown
- **THEN** its changelog heatmap and its newest changelog entries are shown, for that project only

#### Scenario: Knowledge

- **WHEN** the project has a knowledge file and linked documents
- **THEN** the overview lists its sections and its documents, and each document opens in the
  knowledge area

### Requirement: The overview stays current without a reload

Everything the overview shows SHALL be brought up to date from the workspace event stream the rest
of the app already uses. A ticket changing status, a worker starting or finishing a turn, a decision
being raised or answered, a ticket entering or leaving the merge queue, a landing being recorded and
the project's knowledge being written SHALL each be reflected without the page being reloaded.

#### Scenario: A ticket moves

- **WHEN** a ticket of the project changes status while its overview is open
- **THEN** the overview shows it under its new status without a reload

#### Scenario: Something lands

- **WHEN** a ticket of the project lands while its overview is open
- **THEN** the overview's landings and activity include it without a reload

#### Scenario: The queue changes

- **WHEN** a ticket of the project enters or leaves the merge queue while its overview is open
- **THEN** the overview's landing section reflects it without a reload

### Requirement: The overview works on a phone and on a desktop

On a phone viewport the overview SHALL lay out as a single column and each section SHALL be
collapsible, with its heading, and its collapsed or expanded state reported to assistive technology.
From the desktop breakpoint it SHALL lay out in more than one column.

The page SHALL be sized against the region the browser is showing rather than raw viewport units, so
that it obeys the same keyboard and safe-area behaviour as the rest of the app. Opening the overview
SHALL NOT change the bottom bar's geometry or the More menu's contents beyond the project list the
navigation capability requires.

#### Scenario: A phone

- **WHEN** the overview is shown at a phone viewport
- **THEN** its sections are stacked in one column and each can be collapsed and expanded

#### Scenario: A desktop

- **WHEN** the overview is shown at a desktop viewport
- **THEN** its sections are laid out in more than one column

#### Scenario: The bar is unaffected

- **WHEN** the overview is shown on a phone
- **THEN** the bottom bar still shows its five tabs and still lays out within a 390 px viewport
