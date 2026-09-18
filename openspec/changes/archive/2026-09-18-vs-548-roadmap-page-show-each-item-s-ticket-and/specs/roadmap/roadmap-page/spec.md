## MODIFIED Requirements

### Requirement: Each project has a Roadmap page

The V2 app SHALL serve a read-only Roadmap page for one project at
`/w/<ws>/p/<project>/roadmap`, resolving `:project` against the workspace's project list by slug or
id exactly as the project overview does. An address that resolves to no project SHALL show an empty
state naming the address with a way to the workspace's Work screen, rather than an error. The page
SHALL render under the V2 shell with a header that names the project and its Roadmap, and SHALL read
that project's data and no other project's.

The page SHALL render, in order:

- the project's blocks in their order, each with its title, its status, its notes as markdown, and
  its pending tickets in order, each showing its title, its kind and its priority, and its ticket
  state: when the item is linked to a ticket, that ticket's identifier as a link to it together with
  that ticket's **current** status; when the item is not linked, an explicit unfiled marker rather
  than nothing;
- the project's loose items, each with its title, status, notes and linked ticket as the project
  overview shows them; and
- the empty state of the next requirement when the project has neither a block nor a loose item.

The linked ticket's status SHALL be the ticket's current status, following the page's existing live
data mechanism, not a value captured when the item was filed. The page SHALL show it for a block in
any state: `open`, `started` or `done`.

The page SHALL be read-only: it SHALL NOT offer controls that create, edit, reorder, merge, start or
drop a block or a pending ticket.

#### Scenario: A project's roadmap page

- **WHEN** a project with blocks and pending tickets is opened at its roadmap address
- **THEN** its blocks render in order with their pending tickets and ticket links, and its loose
  items render after them

#### Scenario: A pending ticket shows its ticket and status

- **WHEN** a block's pending item is linked to a ticket
- **THEN** the item shows the ticket's identifier as a link to that ticket, and the ticket's current
  status beside it

#### Scenario: A linked ticket's status is live

- **WHEN** the page is open while a linked ticket moves to another status and the page's data
  refreshes through its existing live mechanism
- **THEN** the status shown beside that item becomes the ticket's new status without a reload

#### Scenario: An unfiled pending ticket reads as unfiled

- **WHEN** a block's pending item has no linked ticket
- **THEN** the item shows an explicit unfiled marker instead of a blank or a stale link

#### Scenario: Ticket state shows in every block state

- **WHEN** the page shows an `open`, a `started` and a `done` block
- **THEN** each block's pending items show their linked ticket and status, or their unfiled marker

#### Scenario: Another project's data is absent

- **WHEN** the roadmap page is shown for project A
- **THEN** no block or item of project B appears

#### Scenario: An unknown project

- **WHEN** the roadmap address names no project in the workspace
- **THEN** the page shows an empty state naming the address and offering the workspace's Work screen

#### Scenario: Read-only

- **WHEN** the roadmap page is inspected
- **THEN** it offers no create, edit, reorder, merge, start or drop control

## ADDED Requirements

### Requirement: Blocks collapse, and start collapsed

Each block on the Roadmap page SHALL be expandable and collapsible through a control that reports
its expanded state. Every block SHALL be collapsed when the page first loads, so the page reads as a
list of blocks rather than every item of every block. A collapsed block SHALL still show at least its
title and how many items it holds. Expanding or collapsing a block SHALL be remembered per block in
the same browser and survive a reload, the same way the app remembers other device-local display
choices. The control SHALL be reachable and legible at phone width.

#### Scenario: Blocks start collapsed

- **WHEN** the Roadmap page loads for a project with blocks
- **THEN** each block is collapsed, showing its title and its item count and not its notes or items

#### Scenario: A block expands and collapses

- **WHEN** a block's disclosure control is used
- **THEN** the block expands to show its pending items, and using the control again collapses it

#### Scenario: The choice is remembered per block

- **WHEN** a block is expanded and the page is reloaded
- **THEN** that block is still expanded, while any block left collapsed is still collapsed

#### Scenario: The control works at phone width

- **WHEN** the page is shown at phone width
- **THEN** each block's disclosure control is visible and large enough to use without expanding the
  wrong block
