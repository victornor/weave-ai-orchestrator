## ADDED Requirements

### Requirement: Stub workspace hubs are not drawn

The graph SHALL omit a workspace-scoped hub file (SHARED.md, decisions.md,
WORKSPACE.md) when that file is a stub and is not needed as a parent of
another included hub.

A hub is a stub when it has no section entries and no resolved wiki-link to
another page. A section entry is a non-blank line under a `##` heading that
is not an HTML comment and not a parenthetical fill-in hint (a line that is
only `(...)`). The file title and the headings themselves are not entries.

A hub that has at least one section entry, or that wiki-links to a document,
SHALL be included.

#### Scenario: A stub-only decision log is omitted

- **WHEN** the unscoped graph is requested and decisions.md has only its
  title, comments, and empty or fill-in headings
- **THEN** the graph has no node for the decision log

#### Scenario: Shared conventions with notes is included

- **WHEN** the unscoped graph is requested and SHARED.md has convention notes
  under a section
- **THEN** the graph has a node for Shared conventions, and opening that node
  opens SHARED.md

#### Scenario: A stub shared hub with no links is omitted

- **WHEN** the unscoped graph is requested and SHARED.md is a stub with no
  resolved wiki-links
- **THEN** the graph has no node for Shared conventions

### Requirement: Workspace hubs use honest workspace-scope edges

On the unscoped graph, when both endpoints are present, the graph SHALL
include a structural edge from the workspace hub to the shared hub and from
the workspace hub to the decisions hub. It SHALL NOT invent an edge from a
workspace-scoped hub to a project hub or document.

If the workspace hub is itself a stub but the shared hub or the decisions
hub is included, the workspace hub SHALL still be included so those
structural edges have a parent.

Wiki-link edges already recorded between pages SHALL stay. A shared-scope
document that a project page wiki-links to SHALL still produce that edge
when both pages are in the graph.

#### Scenario: Populated shared hangs off the workspace hub

- **WHEN** the unscoped graph includes both the workspace hub and Shared
  conventions
- **THEN** there is an edge from the workspace hub to Shared conventions, and
  none from Shared conventions to any project page unless that page is
  wiki-linked from SHARED.md

#### Scenario: Stub workspace still parents a populated shared hub

- **WHEN** WORKSPACE.md is a stub and SHARED.md has section entries
- **THEN** the unscoped graph includes both hubs and an edge from the
  workspace hub to Shared conventions

#### Scenario: No fake project link from the decision log

- **WHEN** the unscoped graph includes the decision log and a project hub
- **THEN** there is no edge between the decision log and that project hub
  unless a wiki-link between those two pages exists

### Requirement: A project's graph is that project's pages

When the graph is requested for one project, it SHALL include that project's
hub file and that project's documents, and the wiki-link edges among them.
It SHALL NOT include WORKSPACE.md, SHARED.md, or decisions.md.

#### Scenario: Project graph has no workspace dummies

- **WHEN** the graph is requested for one project whose SHARED.md has
  convention notes and whose decisions.md is a stub
- **THEN** the graph's nodes are that project's hub and documents only
