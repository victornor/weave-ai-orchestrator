# knowledge/document-explorer Specification

## Purpose
Gives a human a file-explorer style view over the knowledge base in the web app — folders, hub files
and documents laid out as a tree that can be browsed and opened, so the knowledge base built for
agents is also legible to a person without querying it one tool call at a time.

## Requirements

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

Clicking a document in the tree SHALL render that document's existing detail view (body, links it
makes, documents that link back to it) in the explorer's content pane, without navigating away from
the explorer. Clicking a hub file SHALL render that hub's existing view in the same content pane.
Clicking a folder SHALL expand or collapse it rather than navigating away from the tree.

#### Scenario: Opening a document from the tree

- **WHEN** a user clicks a document node in the explorer
- **THEN** that document's body, outgoing links and backlinks are shown in the content pane, and
  following a link from there re-opens the content pane at the linked document without leaving the
  explorer

#### Scenario: Opening a hub from the tree

- **WHEN** a user clicks a hub file node in the explorer
- **THEN** that hub file's content is shown in the content pane, using the same view already used
  elsewhere in the Knowledge page for that hub

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

### Requirement: The explorer is a two-pane browser that fills the page

On a desktop viewport the explorer SHALL lay out a tree pane and a content pane side by side,
filling the available width rather than a centred maximum-width column. The tree pane SHALL occupy
roughly one fifth of the width; the content pane SHALL occupy the remainder. The divider between
them SHALL be draggable, and both panes SHALL remain within a bounded range of widths so neither can
be collapsed to nothing by a drag.

#### Scenario: A desktop viewport shows both panes across the full width

- **WHEN** the explorer renders at a desktop viewport width
- **THEN** a tree pane and a content pane are both visible, the content pane is the wider of the two,
  and together they fill the page's available width with no centred narrow column

#### Scenario: Dragging the divider resizes the panes within bounds

- **WHEN** a user drags the divider between the panes
- **THEN** the panes' widths change in response, and neither pane shrinks below its minimum or grows
  beyond its maximum

### Requirement: Each pane scrolls independently

The tree pane and the content pane SHALL each own their vertical scrolling, so content in one pane
SHALL NOT move the other and a page whose panes both fit SHALL NOT scroll as a whole.

#### Scenario: A long document does not move the tree

- **WHEN** the content pane holds a document taller than the viewport
- **THEN** scrolling the content pane reveals the rest of the document and the tree pane does not move

#### Scenario: A long tree does not move the document

- **WHEN** the tree pane holds more nodes than fit its height
- **THEN** scrolling the tree pane reveals the rest of the tree and the content pane does not move

### Requirement: The content pane opens with the project's PROJECT.md selected

Arriving at the explorer with no document named in the URL SHALL NOT show an empty content pane. For
a selected project the content pane SHALL default to that project's `PROJECT.md`; when no project is
selected and at least one project exists, it SHALL default to the first project's `PROJECT.md`.

#### Scenario: Arriving with no selection shows PROJECT.md

- **WHEN** a user opens the explorer for a project and has not selected a document
- **THEN** that project's `PROJECT.md` content is shown in the content pane

#### Scenario: No project selected falls back to the first project

- **WHEN** a user opens the explorer with no project selected and at least one project exists
- **THEN** the first project's `PROJECT.md` content is shown in the content pane

### Requirement: The explorer shows one pane at a time on a narrow viewport

Two panes side by side SHALL NOT be shown at a phone viewport (narrower than the app's `md`
breakpoint). On a narrow viewport the explorer SHALL show the tree pane alone until an entry is
selected, then replace it with the content pane, and SHALL offer a control that returns to the tree.

#### Scenario: A narrow viewport starts on the tree

- **WHEN** the explorer renders at a narrow viewport width with no entry selected
- **THEN** the tree is shown and is navigable, and no content pane is shown beside it

#### Scenario: Selecting an entry shows its content with a way back

- **WHEN** a user selects a document at a narrow viewport
- **THEN** the content pane replaces the tree and the document is readable, and a control returns to
  the tree when used

### Requirement: The selected document is addressable in the explorer's URL

The explorer's URL SHALL name the currently selected document, so a link to a document opens the
explorer with that document selected. The URL SHALL also identify the Explorer tab and, for a
project-scoped document, the project, so the link lands in the same context.

#### Scenario: Selecting a document updates the URL

- **WHEN** a user selects a document in the tree
- **THEN** the explorer's URL names that document alongside the Explorer tab and its project

#### Scenario: A link opens the explorer with the document selected

- **WHEN** the explorer is opened from a URL that names the Explorer tab and a document
- **THEN** that document is selected and its content shown in the content pane, without navigating
  away from the explorer
