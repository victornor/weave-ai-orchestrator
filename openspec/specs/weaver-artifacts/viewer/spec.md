# weaver-artifacts/viewer Specification

## Purpose
Gives a human a URL they can press to see a weaver's artifact rendered inside the web app, and a place
in the workspace to browse every workspace-scoped artifact as a set, reusing the ticket artifact
viewer rather than building a second one.

## Requirements

### Requirement: Publishing a workspace-scoped artifact returns a URL that opens it inside the app
The URL returned by publishing a workspace-scoped artifact SHALL open, when followed, a page rendered
inside the web app that displays the artifact — not a bare HTTP download and not the raw HTML response
directly.

#### Scenario: Following the returned URL
- **WHEN** a human opens the URL returned by a workspace-scoped artifact publish
- **THEN** the web app loads and displays that artifact inside its own page chrome, with no file
  download prompt

### Requirement: The in-app page shows the artifact with a revision picker and the standard actions
The in-app page SHALL render the artifact in a sandboxed frame, offer a way to pick among the
artifact's revisions when it has more than one, and offer the same open-in-new-tab, copy-link, and
download actions already available for a ticket artifact.

#### Scenario: Selecting an artifact with multiple revisions
- **WHEN** a human viewing a workspace-scoped artifact that has been published more than once selects
  a prior revision
- **THEN** the page renders that revision's content, not the current one

#### Scenario: Downloading a workspace-scoped artifact
- **WHEN** a human downloads a workspace-scoped artifact from the page
- **THEN** the resulting file, opened directly from local disk with network access disabled, renders
  with the same AC visual styling as it did inside the page — identically to downloading a ticket
  artifact

### Requirement: Workspace-scoped artifacts are browsable as a set, alongside the project sections
The knowledge base's document explorer SHALL offer a workspace-level entry listing every published
workspace-scoped artifact, ordered by most-recently-updated first, distinct from the existing
per-project ticket-artifacts listing.

#### Scenario: A workspace-scoped artifact is published
- **WHEN** a weaver publishes a workspace-scoped artifact
- **THEN** the explorer's workspace-level artifacts entry lists it, and selecting it opens the same
  in-app page the publish call's returned URL points at

#### Scenario: A newly published artifact appears without a manual reload
- **WHEN** a human is already browsing the explorer when a weaver publishes a new workspace-scoped
  artifact, or a new revision of one
- **THEN** it appears (or moves to the top) of the workspace-level artifacts entry without the human
  needing to reload the page

#### Scenario: A workspace with no workspace-scoped artifacts shows no such entry
- **WHEN** the explorer is opened for a workspace that has never had a workspace-scoped artifact
  published
- **THEN** no workspace-level artifacts entry appears

### Requirement: The same viewer component renders both a ticket artifact and a workspace-scoped one
The web app SHALL use one artifact-viewing component for both a ticket artifact and a workspace-scoped
artifact, rather than a second, forked implementation.

#### Scenario: A workspace-scoped artifact is rendered without a ticket context
- **WHEN** the in-app page renders a workspace-scoped artifact
- **THEN** it uses the same viewing component already used by the ticket page's Artifact tab, with no
  ticket id required for that component to function correctly
