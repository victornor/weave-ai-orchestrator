# ticket-artifacts/storage Specification

## Purpose
Lets an agent publish a self-contained HTML artifact to its ticket with one tool call, storing it as
a revisioned ticket document and recording it as a work product the existing Work surface already
renders, without any new database schema.

## Requirements

### Requirement: An agent publishes an artifact with one tool call
A tool SHALL let an agent store a single HTML document against a ticket under a caller-chosen key,
returning a stable URL and the resulting revision number, with no further action required for the
artifact to appear on the ticket's Work surface.

#### Scenario: First publish under a new key
- **WHEN** an agent publishes an HTML document under a key that has never been used on that ticket
- **THEN** the call succeeds, returns a serve URL and revision `1`, and the ticket's work products
  include one entry of type `artifact` for that key with that URL.

#### Scenario: Publishing again under the same key
- **WHEN** an agent publishes a new HTML document under a key that already has a stored artifact
- **THEN** the call succeeds, returns the same serve URL and an incremented revision number, the
  ticket still has exactly one `artifact` work product for that key, and the document's earlier
  revision remains stored and retrievable by explicit revision number.

### Requirement: The stored body must be a single HTML document under a size cap

The tool SHALL reject a body that is empty, is not recognizable as an HTML document, exceeds a
stated maximum size, or contains a malformed embedded base64 image data URI, with an error naming
which condition failed. For each `data:image/...;base64,...` URI, validation SHALL reject invalid
base64 and bytes that do not form a complete supported raster image; a valid leading signature alone
is not sufficient to accept a truncated payload.

#### Scenario: Empty or non-HTML body

- **WHEN** an agent submits an empty string, or a string with no HTML document markers
- **THEN** the call fails with a validation error describing the requirement, and no document or
  work product is created or modified

#### Scenario: Oversized body

- **WHEN** an agent submits an HTML document larger than the stated size cap
- **THEN** the call fails with a validation error naming the cap, and no document or work product is
  created or modified

#### Scenario: Truncated embedded image is refused

- **WHEN** an agent submits HTML containing an image data URI whose base64 is missing characters or
  whose decoded PNG/JPEG/GIF/WebP bytes are incomplete
- **THEN** the call fails with a validation error identifying the malformed image (including its
  data-URI occurrence or nearby element context), and no artifact revision or work product is
  created

#### Scenario: A complete embedded image is accepted

- **WHEN** an agent submits HTML containing a complete supported raster image as a base64 data URI
- **THEN** artifact validation succeeds and the existing revision/work-product behavior is unchanged

### Requirement: Artifact storage is reserved to the artifact-publishing path
The key space used to store artifact bodies SHALL be reserved so that only the artifact-publishing
tool can create or modify a document within it; the general-purpose ticket document write path SHALL
reject an attempt to use it.

#### Scenario: Writing an artifact-shaped key through the general document tool
- **WHEN** an agent calls the general-purpose ticket document write tool with a key in the space
  reserved for artifacts
- **THEN** the call fails with an error naming the dedicated artifact tool as the correct path, and no
  document is created or modified.

### Requirement: Artifact work products are recorded only by the artifact-publishing path
The general-purpose work-product tool SHALL reject a request to record a work product of type
`artifact`, with an error naming the dedicated artifact-publishing tool as the correct path, and
SHALL create or modify nothing. Artifact work products SHALL be created only by the
artifact-publishing tool, which also stores the artifact document they describe, so every artifact
work product the general tool could once have produced is no longer possible.

#### Scenario: Recording an artifact through the general work-product tool
- **WHEN** an agent calls the general-purpose work-product tool with type `artifact`
- **THEN** the call fails with an error naming the artifact-publishing tool, and no work product is
  created

#### Scenario: Publishing through the artifact tool still records exactly one work product
- **WHEN** an agent publishes an artifact through the artifact-publishing tool
- **THEN** the ticket has one `artifact` work product for that key, backed by its stored document,
  exactly as before
