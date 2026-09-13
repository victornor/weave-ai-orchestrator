# web-v2/artifacts Specification

## Purpose
An artifact is a self-contained HTML document an agent published to a ticket or a workspace; V2
renders it in the same sandboxed, no-network frame V1 uses, inline on its ticket and in a full-screen
reader.

## Requirements

### Requirement: An artifact renders in a sandboxed frame with no network access

V2 SHALL render an artifact through the existing raw-serve routes — `/tickets/:id/artifacts/:key/raw`
for a ticket artifact and `/artifacts/:key/raw` for a workspace artifact, styled from
`/artifacts/kit.css` — inside the same sandboxed frame V1 uses. The frame SHALL NOT be able to make
network requests, and the UI SHALL state that the artifact is sandboxed and cannot call the daemon.

#### Scenario: The frame is sandboxed

- **WHEN** an artifact is rendered in V2
- **THEN** its document is loaded through the raw-serve route in a sandboxed frame whose content
  cannot reach the network, and the UI says so

#### Scenario: A workspace-scoped artifact

- **WHEN** an artifact belongs to the workspace rather than a ticket
- **THEN** it renders through the workspace raw-serve route in the same frame

### Requirement: A ticket's artifact renders inline on the ticket, above the fold

Opening a ticket's Artifacts tab SHALL render the selected artifact inline, above the fold, in the
sandboxed frame, without a navigation away from the ticket.

#### Scenario: Inline on the ticket

- **WHEN** the user opens a ticket with a published artifact on its Artifacts tab
- **THEN** the artifact's content is rendered inline in the sandboxed frame on that tab

### Requirement: A full-screen reader carries the ticket context and a way back

V2 SHALL provide a full-screen artifact reader whose header carries the artifact's title and its
ticket context — the ticket identifier, its project in the project's hue, and the worker — and a
control that opens that ticket. The reader SHALL render the artifact in the same sandboxed frame and
SHALL support choosing a revision and opening, copying the link to, and downloading the artifact.

#### Scenario: Reading an artifact full screen

- **WHEN** the user opens a ticket artifact in the full-screen reader
- **THEN** the reader's header shows the artifact title and the ticket context, and the artifact
  renders in the sandboxed frame

#### Scenario: Back to the ticket

- **WHEN** the user activates the reader's ticket control
- **THEN** the app opens the ticket the artifact belongs to

#### Scenario: Choosing a revision

- **WHEN** an artifact has more than one revision
- **THEN** the reader lets the user select which revision is rendered

### Requirement: A workspace-scoped reader is reachable for Knowledge to link into

V2 SHALL keep a workspace-scoped artifact reader address at `/v2/w/$ws/artifacts/$key` for an
artifact that belongs to the workspace and not to a ticket, so the Knowledge screen can link into it.

#### Scenario: Opening a workspace artifact by key

- **WHEN** a workspace artifact's key is opened at the workspace artifact address
- **THEN** the reader renders that artifact in the sandboxed frame

#### Scenario: An unknown key

- **WHEN** the workspace artifact address names a key the workspace does not have
- **THEN** the reader states the artifact was not found rather than rendering an empty frame
