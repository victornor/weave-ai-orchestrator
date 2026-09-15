## Purpose

Gives each project a full read-only Roadmap page, reachable from the project overview and from a
sub-link under the project in the sidebar, where captain can see the blocks the weaver is building
up, their pending tickets, what they became, and where an empty roadmap says to ask the weaver.

## ADDED Requirements

### Requirement: Each project has a Roadmap page

The V2 app SHALL serve a read-only Roadmap page for one project at
`/w/<ws>/p/<project>/roadmap`, resolving `:project` against the workspace's project list by slug or
id exactly as the project overview does. An address that resolves to no project SHALL show an empty
state naming the address with a way to the workspace's Work screen, rather than an error. The page
SHALL render under the V2 shell with a header that names the project and its Roadmap, and SHALL read
that project's data and no other project's.

The page SHALL render, in order:

- the project's blocks in their order, each with its title, its status, its notes as markdown, and
  its pending tickets in order, each showing its title, its kind and its priority, and — when it has
  one — a link to the ticket it became;
- the project's loose items, each with its title, status, notes and linked ticket as the project
  overview shows them; and
- the empty state of the next requirement when the project has neither a block nor a loose item.

The page SHALL be read-only: it SHALL NOT offer controls that create, edit, reorder, merge, start or
drop a block or a pending ticket.

#### Scenario: A project's roadmap page

- **WHEN** a project with blocks and pending tickets is opened at its roadmap address
- **THEN** its blocks render in order with their pending tickets and ticket links, and its loose
  items render after them

#### Scenario: Another project's data is absent

- **WHEN** the roadmap page is shown for project A
- **THEN** no block or item of project B appears

#### Scenario: An unknown project

- **WHEN** the roadmap address names no project in the workspace
- **THEN** the page shows an empty state naming the address and offering the workspace's Work screen

#### Scenario: Read-only

- **WHEN** the roadmap page is inspected
- **THEN** it offers no create, edit, reorder, merge, start or drop control

### Requirement: An empty roadmap explains how to start one and opens the chat

A project with no block and no loose item SHALL show an empty state reading, in substance, "No
roadmap yet. Ask the weaver about roadmaps", together with a button or link that opens the
workspace's chat with a prompt asking the weaver to explain roadmaps and how they save tokens,
already in the composer before it is sent.

#### Scenario: The empty state

- **WHEN** a project has no block and no loose item
- **THEN** the roadmap page shows an empty state saying to ask the weaver about roadmaps

#### Scenario: The empty state opens chat with the prompt

- **WHEN** the empty state's action is used
- **THEN** the workspace's chat opens with a prompt about roadmaps already in the composer, unsent
  and editable
