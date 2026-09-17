# web-v2/project-overview Specification

## Purpose
The V2 project overview: one project's history, pull requests, landings, activity, waiting decisions,
work under way and knowledge, in one place, rendered in V2's Mono language. It is the kept V1 project
overview restyled, with the same data and behaviour.

## Requirements

### Requirement: The overview resolves a project and shows its kept sections

The screen SHALL resolve the address against the workspace's project list, accepting either a project's slug or its id, and SHALL render the project's own sections: its about/identity block, Roadmap, Roles, History, Pull requests, Recent landings, Activity, Needs you, Work under way and Knowledge. Each section SHALL read its own data. An address that resolves to no project in the workspace SHALL show an empty state naming the address, with a way to the workspace's Work screen, rather than an error.

#### Scenario: A project by slug or id

- **WHEN** the address names an existing project's slug or its id
- **THEN** the overview renders that project's sections

#### Scenario: All sections render

- **WHEN** a project's overview renders
- **THEN** Roadmap, Roles, History, Pull requests, Recent landings, Activity, Needs you, Work under way and Knowledge are each present, and each shows its own data or its own empty state

#### Scenario: No such project

- **WHEN** the address resolves to no project in the workspace
- **THEN** the screen shows an empty state naming the address and offering the workspace's Work screen

### Requirement: The header reaches the project's V2 screens

The overview's header SHALL offer the project-scoped destinations V2 has — Work, Knowledge and Chat —
as links into V2, each to an address that exists. It SHALL NOT offer the merge queue (V2 has no
merge-queue route) nor a separate Specs link (V2 has no specs route; the project's specs are browsed in
its Knowledge screen), and it SHALL NOT link back to V1.

#### Scenario: The header links

- **WHEN** the overview renders
- **THEN** its header links to the project's Work, Knowledge and Chat V2 destinations

#### Scenario: No dead destination

- **WHEN** the overview's header is inspected
- **THEN** every link is to an address the V2 router serves, with no merge-queue and no separate Specs
  link

### Requirement: History draws the commit graph and its pull requests draw diffs

The History section SHALL render the project's commit graph — the default branch plus its live worker
and ticket branches as lanes with merge and branch lines, read a page at a time — and allow opening a
commit to its detail. The Pull requests section SHALL list the project's open and recent pull requests,
open one to its description, checks and changed files, and render those files' diffs through the shared
diff renderer, including the split/unified layout and its fit-to-column behaviour. Both sections SHALL
be read-only: neither approves, merges, reviews or comments.

#### Scenario: The commit graph

- **WHEN** the History section has commits
- **THEN** it draws the commit lanes and opens a commit's detail when one is chosen

#### Scenario: A pull request's diff

- **WHEN** a pull request is opened
- **THEN** its changed files render through the shared diff renderer, with the layout control and
  per-file hunks

#### Scenario: One pull request at a time

- **WHEN** the human opens a pull request and then returns to the list
- **THEN** the overview shows the list again, and the opened pull request is addressable from the URL

### Requirement: About, needs you, work, landings, activity and knowledge are shown

The overview SHALL show the project's git URL, default branch, delivery mode and sync state, and its
Current focus from the project knowledge file. It SHALL show the project's open human decisions with a
link to each ticket, its unfinished tickets folded by the board's columns with the worker on each, what
landed recently, the recent changelog with its heatmap, and the project knowledge file's sections, linked
documents and knowledge health. A section with no data SHALL show its own empty state.

#### Scenario: The about block

- **WHEN** a project's overview renders
- **THEN** its git URL, default branch, delivery mode and sync state are shown, and Current focus is
  shown when the project knowledge file has one

#### Scenario: Needs you and Work

- **WHEN** the project has open decisions and unfinished tickets
- **THEN** they appear in the Needs you and Work under way sections, each linking to its ticket

#### Scenario: Activity links to the full changelog

- **WHEN** the Activity section shows the recent record
- **THEN** it offers the project's full changelog, and its entries link to their tickets

### Requirement: The overview marks a project with YOLO mode on

When YOLO mode is on for the project, the overview's header SHALL show a visible marker saying that
the daemon grants that project's plan and merge approvals itself and that action approvals still
come to the human. When the mode is off, no such marker SHALL be shown.

#### Scenario: A project with the mode on

- **WHEN** the overview renders for a project whose `policies.yolo` is true
- **THEN** its header shows a marker naming the mode and that action approvals still come to the human

#### Scenario: A project with the mode off

- **WHEN** the overview renders for a project with no YOLO mode
- **THEN** no YOLO marker is shown

### Requirement: The overview lists the project's roles under its roadmap

The overview SHALL list the project's hired roles in a section immediately following Roadmap. Each listed role SHALL show its name, its state, and whether its persistent session already exists or would be created when opened, so an existing conversation is distinguishable before activation from one that would start. Choosing a role's session control SHALL open that role's persistent session through the same operation the roles screen uses. A role that cannot serve a session (its status is not `active`) SHALL NOT offer the control and SHALL state the reason. A project with no hired roles SHALL say so rather than showing an empty list.

#### Scenario: Every role of the project is listed under the roadmap

- **WHEN** a project's overview renders and the project has hired roles
- **THEN** each role is listed in a section immediately after Roadmap, with its name and state

#### Scenario: An existing session and a new one look different

- **WHEN** one listed role already has a persistent session and another does not
- **THEN** the first offers to open its conversation and the second offers to start one

#### Scenario: Opening from the overview

- **WHEN** the human chooses a role's session control on the overview
- **THEN** that role's persistent session opens and its conversation is shown

#### Scenario: A role that cannot serve a session

- **WHEN** a listed role is paused or retired
- **THEN** its row offers no session control and states the reason

#### Scenario: A project with no roles

- **WHEN** a project's overview renders and the project has no hired roles
- **THEN** the Roles section says so rather than showing an empty list
