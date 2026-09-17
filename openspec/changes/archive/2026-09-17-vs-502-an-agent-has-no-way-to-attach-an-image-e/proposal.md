## Why

Workers already have rendered screenshots on disk, but publishing them requires retyping their
binary bytes as base64 inside an artifact tool call. Larger images have arrived truncated or with
lost base64 characters, and artifact publishing accepts the damaged HTML silently. This change
gives workers a server-side path-to-file attachment flow with actionable integrity metadata and
makes malformed embedded images fail before they become review evidence.

## What Changes

- Add a ticket-scoped `weave_ticket_attachment_put` tool that reads a worker-provided path on the
  server, stores the bytes under a generated name, and returns the attachment URL, media type,
  byte count, and checksum.
- Reuse the existing outbound attachment path allowlist and size policy; validate every path before
  writing anything, and keep attachment bytes outside served/static directories.
- Expose ticket attachments to the human ticket view and to `weave_ticket_get`, including image
  content for agent-side review, with authenticated ticket-scoped serving and download behavior.
- Reject self-contained artifact HTML containing an invalid or truncated base64 image data URI,
  naming the failed image, before creating a document revision or work product.
- Add integration, service, artifact-validation, and UI coverage using a real PNG large enough to
  exercise the former transport failure.

## Capabilities

### New Capabilities

- `ticket-attachments`: lets an agent attach an existing file to its ticket by path, verify the
  stored bytes, and lets humans and ticket readers review the resulting attachment safely.

### Modified Capabilities

- `ticket-artifacts/storage`: artifact HTML now validates embedded base64 image data URIs before
  storage and reports the specific malformed image.

## Impact

- `packages/db/src/migrations/` gains ticket-attachment metadata storage; attachment bytes reuse
  the workspace's non-served attachment directory and generated storage keys.
- `packages/core` gains ticket attachment persistence/read methods and integrity metadata, reusing
  the existing outbound path resolver and attachment filename/media-type policy.
- `packages/server` gains the worker tool, ticket detail metadata, and a human-authenticated binary
  route; shared tool registration and agent-facing descriptions are updated.
- `packages/ui` adds attachment metadata/types, ticket-detail loading, image/download rendering,
  and query invalidation for newly published attachments.
- Tests cover allowlist enforcement, round-trip bytes and checksum, cross-ticket access, malformed
  artifact data URIs, HTTP serving, MCP image content, and the ticket view.
