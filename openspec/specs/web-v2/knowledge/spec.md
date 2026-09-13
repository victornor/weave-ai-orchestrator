# web-v2/knowledge Specification

## Purpose
The workspace Knowledge destination in V2: one search across knowledge and specs, every workspace and
project knowledge base as a readable row with its budget meter, the spec capability and change pages,
and the artifacts workers publish — all reuse of V1's data hooks, restyled onto the Mono primitives.

## Requirements

### Requirement: The Knowledge home is workspace-scoped

The V2 app SHALL render the Knowledge destination at `/v2/w/<ws>/knowledge` for the workspace named in
the path, showing only that workspace's knowledge bases, documents, capabilities and artifacts. The
destination SHALL carry V1's knowledge capability without a second backend: it SHALL read the existing
`packages/ui/src/api` hooks and issue no new HTTP route. The destination's rail row SHALL be the
workspace `Knowledge` row and its header SHALL name the workspace.

#### Scenario: Opening a workspace's Knowledge

- **WHEN** a signed-in user opens `/v2/w/<ws>/knowledge`
- **THEN** the V2 Knowledge screen renders for that workspace, the workspace `Knowledge` rail row is
  highlighted, and the header names the workspace

#### Scenario: Knowledge is workspace-scoped

- **WHEN** the Knowledge screen shows its knowledge bases, capabilities and artifacts
- **THEN** they belong to the workspace named in the path, not to another workspace

### Requirement: One search covers knowledge and specs, with kind filters

The Knowledge screen SHALL provide one search field that queries both knowledge and specs for the
current workspace and SHALL show the matching knowledge, capability, requirement and change hits. It
SHALL offer kind filters — Everything, Knowledge, Specs and Artifacts — that narrow what the screen
shows: a search-result kind when a query is active, and the corresponding section when it is not.

#### Scenario: A query returns knowledge and spec hits

- **WHEN** the user types a query that matches a knowledge document and a capability in the current
  workspace
- **THEN** the screen lists both the knowledge hit and the spec hit

#### Scenario: The Knowledge filter

- **WHEN** the user selects the Knowledge filter with a query active
- **THEN** only knowledge-kind hits are shown

#### Scenario: The Specs filter

- **WHEN** the user selects the Specs filter with a query active
- **THEN** only capability, requirement and change hits are shown

#### Scenario: The Artifacts filter

- **WHEN** the user selects the Artifacts filter
- **THEN** the published artifacts list is shown

### Requirement: Every workspace and project knowledge base is a row with its meter

The Knowledge screen SHALL list the workspace's knowledge bases and each project's knowledge base as
rows. A project's row SHALL be labelled in that project's hue. Each row SHALL show the base's size
against its budget as a meter and SHALL show when it was last curated, or that curation is due. A
workspace knowledge base SHALL be listed for the workspace and each project knowledge base SHALL be
listed for its project, so no base is hidden.

#### Scenario: The workspace and project bases are listed

- **WHEN** the Knowledge screen renders a workspace with one or more projects
- **THEN** the workspace's knowledge base and every project's knowledge base each appear as a row

#### Scenario: A project row carries its hue

- **WHEN** a project knowledge base is listed
- **THEN** its row is labelled in that project's hue, the same hue the project has elsewhere

#### Scenario: Each row shows its meter and curation date

- **WHEN** a knowledge base row renders
- **THEN** it shows the base's tokens against its budget and its last-curated date, or that curation
  is due

### Requirement: A knowledge base is readable and editable

Opening a knowledge base SHALL show its hub body, and the screen SHALL offer, with V1's parity, editing
and saving the body, its revision history, reverting to a revision, and triggering curation now.

#### Scenario: Reading a base

- **WHEN** the user opens a knowledge base row
- **THEN** its hub body is shown

#### Scenario: Editing a base

- **WHEN** the user edits the body and saves
- **THEN** the body is written through the existing knowledge mutation and the displayed body updates

#### Scenario: Revision history and revert

- **WHEN** the user opens a base's revisions
- **THEN** its revisions are listed and each can be reverted through the existing mutation

#### Scenario: Curate now

- **WHEN** the user triggers curation on a base
- **THEN** curation is requested through the existing mutation

### Requirement: Specs browse to a capability page and a change page

The Knowledge screen SHALL list the workspace's spec capabilities and SHALL open a capability page
showing its requirements, any inline pending delta and its change history, and a change page showing
its tasks, proposal, design and deltas. The spec views SHALL be read-only and SHALL read the existing
spec hooks.

#### Scenario: The capability list

- **WHEN** the Knowledge screen renders a project with archived capabilities
- **THEN** its capabilities are listed with their requirement counts and any pending change

#### Scenario: Opening a capability

- **WHEN** the user activates a capability
- **THEN** its requirements, any inline pending delta and its change history are shown

#### Scenario: Opening a change

- **WHEN** the user activates a change from a capability or the change list
- **THEN** its tasks, proposal, design and deltas are shown

### Requirement: Artifacts are browsable and link to the reader

The Knowledge screen SHALL list artifacts published by workers for the current workspace and SHALL link
each to its V2 reader address, so an artifact can be opened from Knowledge. The artifact reader's own
content is owned by the Work screen ticket; this screen only lists and links.

#### Scenario: Listing artifacts

- **WHEN** the workspace has published artifacts
- **THEN** the Knowledge screen lists them with their title, ticket and project

#### Scenario: Opening an artifact

- **WHEN** the user activates an artifact row
- **THEN** the app navigates to that artifact's V2 reader address
