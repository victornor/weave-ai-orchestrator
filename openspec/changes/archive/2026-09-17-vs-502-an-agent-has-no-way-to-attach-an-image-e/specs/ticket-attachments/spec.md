# ticket-attachments Specification

## Purpose

Lets an agent attach a real file already present in its allowed workspace or worktree to a ticket
without routing the file's bytes through model output, and lets reviewers inspect those bytes from
the ticket surface or an authorized ticket read.

## ADDED Requirements

### Requirement: An agent can attach a file by path

The agent tool `weave_ticket_attachment_put` SHALL accept a ticket id, a filesystem path, and an
optional display label. The server SHALL read the file itself, store it under a generated storage
name, and return an attachment id, stable ticket-scoped URL, display label, detected media type,
byte size, and SHA-256 checksum. The request SHALL never require file bytes or base64 content in the
tool input.

#### Scenario: A worker attaches a PNG and verifies it

- **WHEN** a worker calls the tool with a valid PNG path on its own worktree
- **THEN** the call succeeds, the returned byte size equals the source file size, the checksum is
  the SHA-256 of the source bytes, and a subsequent authorized read returns the identical bytes

#### Scenario: The label defaults safely

- **WHEN** the worker omits the label
- **THEN** the stored display label is the sanitized basename of the supplied path, and that label
  is never used to construct a storage path

### Requirement: Attachment paths use the existing explicit allowlist

The tool SHALL resolve a supplied path through its real path and accept only a regular file inside
the workspace knowledge tree, a project clone, or a worker worktree already allowed by outbound
attachments. Symlinks resolving outside those roots, any `.git` path segment, unreadable/non-regular
paths, and files over the outbound per-file cap SHALL be rejected by name before any row or file is
written. Validation SHALL be all-or-nothing for the request.

#### Scenario: A path outside the allowlist is refused

- **WHEN** a worker names a readable file outside the knowledge, project, and worker-worktree roots
- **THEN** the call fails with a validation error naming that path, and no attachment is stored

#### Scenario: A large real screenshot is accepted within the cap

- **WHEN** a worker names a valid image larger than the former base64 tool-call payload but within
  the outbound per-file cap
- **THEN** the call succeeds without requiring the worker to transcribe or resize the image

### Requirement: Ticket attachments are scoped and safely served

Attachment bytes SHALL be stored outside static content under a server-generated key. A human web
session SHALL be able to fetch an attachment only through its owning ticket's authenticated route;
unknown attachment ids, another ticket id, agent run credentials, and another workspace SHALL not
reveal the bytes. Image media types SHALL render inline, while other types SHALL be offered as a
download with the stored display label.

#### Scenario: A reviewer opens an attached image

- **WHEN** an authenticated human requests the attachment URL for its owning ticket
- **THEN** the response has the stored bytes and media type, includes its byte length, and the image
  can render from the ticket page

#### Scenario: Cross-ticket access is refused

- **WHEN** a request uses the correct attachment id with a different ticket id
- **THEN** the request is rejected as not found and the bytes are not read

### Requirement: Ticket reads expose reviewable attachment evidence

The human ticket detail response SHALL include attachment metadata and links. `weave_ticket_get`
SHALL include the same metadata; for image attachments it SHALL additionally return image content in
the MCP result so the weaver can inspect the evidence without lifting the agent-only artifact-body
read restriction.

#### Scenario: The weaver reads a ticket with an image attachment

- **WHEN** the weaver calls `weave_ticket_get` for a ticket containing an attached PNG
- **THEN** the result lists its label, media type, size, checksum, and URL and includes the actual
  image bytes as renderable MCP image content

### Requirement: Attachment metadata and bytes round-trip without silent corruption

The attachment result SHALL be derived from the bytes written and SHALL include enough information
for the producer to detect a mismatch. A failed storage or metadata transaction SHALL not leave an
orphaned attachment row or a reviewable partial file.

#### Scenario: A checksum detects a changed source

- **WHEN** the producer compares the returned checksum with a checksum of the source file it sent
- **THEN** equal checksums and byte sizes establish that the stored payload is byte-identical

