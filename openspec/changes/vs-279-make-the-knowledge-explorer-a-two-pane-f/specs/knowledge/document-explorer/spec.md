## MODIFIED Requirements

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

## ADDED Requirements

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
