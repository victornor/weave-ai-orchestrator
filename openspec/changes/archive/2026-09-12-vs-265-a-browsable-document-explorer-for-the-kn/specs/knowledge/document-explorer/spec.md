## Purpose

Gives a human a file-explorer style view over the knowledge base in the web app — folders, hub files
and documents laid out as a tree that can be browsed and opened, so the knowledge base built for
agents is also legible to a person without querying it one tool call at a time.

## ADDED Requirements

### Requirement: The explorer shows every visible document and hub as a folder tree

The Knowledge page SHALL offer an explorer view presenting, for the selected project scope (or every
project when none is selected, matching the existing project filter), a tree built from each visible
document's folder path plus that scope's hub files. A document with no folder SHALL appear at its
scope's root. A folder with no documents directly in it but with documents nested further inside
SHALL still appear, so a two-level-deep document is reachable without knowing its exact path in
advance.

#### Scenario: A nested document is reachable through its folder chain

- **WHEN** a document exists at folder `research/competitors`
- **THEN** the explorer shows a `research` node containing a `competitors` node containing that
  document, expandable down to it

#### Scenario: The tree matches the document catalogue

- **WHEN** the explorer is opened for a project
- **THEN** every document `ac_knowledge_docs` reports for that project scope appears exactly once in
  the tree, at the folder it reports

### Requirement: Hub files are visually distinguished from documents

`PROJECT.md`, `WORKSPACE.md` and `SHARED.md` (and the workspace decisions log) are governed
differently from linked documents — they are curated in place rather than freely authored. The
explorer SHALL render them distinctly from folders and documents (a different affordance, not merely
a different icon buried in shared styling) and SHALL place them where a person looks for the root of
a scope, not mixed arbitrarily among folders.

#### Scenario: A hub file is not mistaken for a document

- **WHEN** the explorer renders a project's tree
- **THEN** that project's `PROJECT.md` is visually distinguishable from the folders and documents
  beneath it, without requiring the user to open it to tell the difference

### Requirement: Opening a tree entry shows its content

Clicking a document in the tree SHALL open that document's existing detail view (body, links it
makes, documents that link back to it). Clicking a hub file SHALL open that hub's existing view.
Clicking a folder SHALL expand or collapse it rather than navigating away from the tree.

#### Scenario: Opening a document from the tree

- **WHEN** a user clicks a document node in the explorer
- **THEN** that document's body, outgoing links and backlinks are shown, and following a link from
  there re-opens the tree at the linked document

#### Scenario: Opening a hub from the tree

- **WHEN** a user clicks a hub file node in the explorer
- **THEN** that hub file's content is shown, using the same view already used elsewhere in the
  Knowledge page for that hub

### Requirement: The archive is visible without cluttering the tree

Deleting a document or curating a hub already archives removed content to a dated file on disk. The
explorer SHALL make each scope's archived files reachable — collapsed by default, out of the way of
the live folder tree — and openable as read-only content, rather than leaving them invisible outside
the filesystem.

#### Scenario: Archived content is reachable but out of the way

- **WHEN** a scope has one or more dated archive files
- **THEN** the explorer shows a single collapsed archive entry for that scope that, when expanded,
  lists those dated files, and does not show them among the live folders and documents by default

#### Scenario: A scope with no archive shows no archive entry

- **WHEN** a scope has never had a document deleted or a hub curated
- **THEN** the explorer shows no archive entry for that scope

### Requirement: The explorer matches the app's design tokens in both themes

The explorer SHALL be built from the existing design tokens and components used elsewhere in the app
(`packages/ui/src/index.css` and neighbouring routes), not bespoke colors or spacing, and SHALL be
legible and usable in both light and dark mode.

#### Scenario: The explorer respects the active theme

- **WHEN** the app's theme is switched between light and dark
- **THEN** the explorer's tree, hub and document affordances all remain legible and use the same
  token set as the rest of the Knowledge page, with no hardcoded color that ignores the theme
