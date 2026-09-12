# weaver-artifacts/storage Specification

## Purpose
Lets a weaver — an agent with no ticket to attach a document to — publish a self-contained HTML
artifact with one tool call, stored against the workspace rather than any ticket, with the same
validation and revisioning contract as a ticket artifact.

## Requirements

### Requirement: A weaver publishes an artifact scoped to the workspace, not a ticket
A tool SHALL let a weaver store a single HTML document under a caller-chosen key scoped to its
workspace, with no ticket involved, returning a URL and the resulting revision number.

#### Scenario: First publish under a new key
- **WHEN** a weaver publishes an HTML document under a key that has never been used in that
  workspace
- **THEN** the call succeeds, returns a URL and revision `1`, and the artifact is retrievable by that
  key with no ticket id required anywhere in the call

#### Scenario: Publishing again under the same key
- **WHEN** a weaver publishes a new HTML document under a key that already has a stored artifact in
  that workspace
- **THEN** the call succeeds, returns the same key's URL and an incremented revision number, exactly
  one artifact exists for that key, and the earlier revision remains stored and retrievable by
  explicit revision number

### Requirement: The stored body must be a single HTML document under a size cap
The tool SHALL reject a body that is empty, is not recognizable as an HTML document, or exceeds a
stated maximum size, with an error naming which condition failed — the same validation a ticket
artifact is held to.

#### Scenario: Empty or non-HTML body
- **WHEN** a weaver submits an empty string, or a string with no HTML document markers
- **THEN** the call fails with a validation error describing the requirement, and no artifact is
  created or modified

#### Scenario: Oversized body
- **WHEN** a weaver submits an HTML document larger than the stated size cap
- **THEN** the call fails with a validation error naming the cap, and no artifact is created or
  modified

### Requirement: Publishing a workspace-scoped artifact is reserved to the weaver
A worker, which already has a ticket to publish artifacts against, SHALL NOT be able to call the
workspace-scoped publishing tool; only the one weaver of a workspace can.

#### Scenario: A worker attempts to publish without a ticket
- **WHEN** a worker's agent session attempts to call the workspace-scoped artifact publishing tool
- **THEN** the call is rejected before any document or artifact record is created, because the tool is
  not available to a worker's session at all

### Requirement: A workspace-scoped artifact's key is independent of any ticket's artifact keys
The same key value used by a ticket artifact and a workspace-scoped artifact SHALL be able to coexist
without collision, since they are stored in entirely separate homes.

#### Scenario: The same key exists on a ticket and in the workspace store
- **WHEN** a ticket already has a published artifact under key `report` and a weaver separately
  publishes a workspace-scoped artifact under key `report`
- **THEN** both exist independently, each reachable only through its own home's URL, with neither
  call affecting the other
