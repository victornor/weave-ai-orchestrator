# project-overview/pull-requests Specification

## Purpose
Describes the project overview's Pull requests section: which of a project's pull requests it lists,
what each one is joined to — the ticket that produced it, the spec change it implements, its checks
and its place in the merge queue — what opening one shows, how the forge's answers are kept current
without hammering it, and what a project with no forge sees instead.

## Requirements

### Requirement: The overview lists the project's pull requests

The project overview's Pull requests section SHALL list the pull requests of the repository the
project is a clone of. Pull requests that are open SHALL be listed first, then those merged or
closed within the last 30 days, most recently updated first within each group. Older pull requests
SHALL NOT be listed.

Each entry SHALL show the pull request's number, its title, its author, the branch it is from, and
whether it is open, merged, closed or a draft.

A project whose repository has no pull requests in that window SHALL be told so plainly.

#### Scenario: Open before recent

- **WHEN** a project has open pull requests and pull requests merged in the last 30 days
- **THEN** the section lists the open ones first and the merged ones after them

#### Scenario: Old pull requests are left out

- **WHEN** a pull request was merged or closed more than 30 days ago
- **THEN** it is not listed

#### Scenario: Nothing in the window

- **WHEN** a project's repository has no open pull requests and none merged or closed in the last 30
  days
- **THEN** the section says there are none, and shows no error

### Requirement: A pull request is joined to its ticket, its spec change and its checks

An entry SHALL show the ticket the pull request belongs to, when one is known, as a link to that
ticket. A pull request SHALL be recognised as a ticket's when that ticket records it as a work
product, and otherwise when it is from that ticket's branch.

When the ticket implements an OpenSpec change, the entry SHALL show that change's name as a link to
the spec change view of that change, for the project the pull request belongs to.

Each entry SHALL show the state of the pull request's checks — passing, failing, running, or none
reported — and its review state where the forge reports one.

An entry whose pull request belongs to a ticket that is waiting in the project's merge queue SHALL
show that it is queued and its position; one that is merging now SHALL show that it is landing.

A pull request that belongs to no ticket SHALL still be listed, without a ticket, a spec change or a
queue position.

#### Scenario: The ticket and the change are reachable

- **WHEN** a listed pull request is recorded as the work product of a ticket that implements an
  OpenSpec change
- **THEN** the entry links to that ticket and to that change's spec view

#### Scenario: Matched by branch

- **WHEN** a listed pull request records no work product but is from the branch of one of the
  project's tickets
- **THEN** the entry links to that ticket

#### Scenario: Queue position is shown

- **WHEN** a listed pull request's ticket is waiting in the project's merge queue
- **THEN** the entry shows that it is queued and where in the queue it is

#### Scenario: A pull request nobody filed

- **WHEN** a listed pull request matches no ticket
- **THEN** it is listed with its own details and without a ticket, a change or a queue position

### Requirement: Opening a pull request shows its description and what it changes

Opening a listed pull request SHALL show its description, the files it changes with the number of
lines added and removed for each and in total, and the result of each of its checks. It SHALL offer
a link that opens the pull request on the forge.

Where the pull request belongs to a ticket that has a plan document, opening the pull request SHALL
put that plan one click away.

Which pull request is open SHALL be part of the overview's address, so that an open pull request can
be linked to and returned to, and closing it SHALL return to the list.

The section SHALL NOT offer approving, merging, reviewing or commenting on a pull request: merge
approval remains a decision.

#### Scenario: The diff summary

- **WHEN** a pull request is opened from the section
- **THEN** its description, its changed files with their additions and deletions, and its checks are
  shown, with a link to the forge

#### Scenario: The plan is one click away

- **WHEN** an opened pull request belongs to a ticket that has a plan document
- **THEN** that plan is reachable in one click

#### Scenario: An opened pull request is addressable

- **WHEN** the overview is opened at the address of one of its pull requests
- **THEN** that pull request is the one shown

#### Scenario: Read-only

- **WHEN** a pull request is opened from the section
- **THEN** nothing offers to approve it, merge it, review it or comment on it

### Requirement: Forge answers are cached and refreshed on ticket change

Pull request data SHALL be served to clients from the daemon, which SHALL cache what it read from
the forge for a few minutes per project and answer from that cache within that window, so that
opening, re-opening or leaving open a project's overview does not produce a forge request each time.

The cache for a project SHALL be discarded when one of that project's tickets records a work product
or changes its merge state, so the section reflects a pull request that has just been opened, queued
or merged without waiting for the cache to expire.

Clients SHALL be told to re-read the section on those same changes.

A forge request that fails SHALL NOT discard a cached answer that is still within its window.

#### Scenario: Repeated views do not repeat the forge request

- **WHEN** a project's pull requests are requested twice within the cache window
- **THEN** the forge is asked once and the second request is answered from the cache

#### Scenario: A new pull request appears

- **WHEN** a ticket of the project records a pull request as its work product
- **THEN** the cached answer for that project is discarded and the section shows the new pull request
  without waiting for the window to pass

#### Scenario: A merge shows up

- **WHEN** a ticket of the project changes its merge state
- **THEN** the cached answer for that project is discarded and clients re-read the section

### Requirement: A project without a forge says so instead of failing

When a project has no forge — no remote the forge recognises, no forge tool available, or a forge
tool that is not authenticated — the section SHALL state that pull requests are not available for
this project and why, and SHALL NOT show an error, a retry or a loading state that never ends.

The same SHALL hold when the forge is available but cannot be reached: the section SHALL say the
forge could not be reached, and the rest of the overview SHALL be unaffected either way.

#### Scenario: No forge for this project

- **WHEN** a project's overview is shown and the project has no authenticated forge
- **THEN** the Pull requests section says pull requests are not available for this project, with the
  reason, and shows no error and no retry

#### Scenario: The forge is unreachable

- **WHEN** the forge is configured but a request to it fails
- **THEN** the section says the forge could not be reached, and the overview's other sections render
  as they otherwise would

### Requirement: The section reads on a phone and on a desktop

The Pull requests section SHALL be usable within the overview's layout at a phone width and at a
desktop width, listing and opening a pull request in both without horizontal scrolling, and SHALL
keep the collapse behaviour every section of the overview has.

#### Scenario: Phone

- **WHEN** the overview is shown at a phone width
- **THEN** the Pull requests section lists and opens a pull request in a single column, and can still
  be collapsed
