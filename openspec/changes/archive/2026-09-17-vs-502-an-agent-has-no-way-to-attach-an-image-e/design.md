## Context

Ticket artifacts are currently revisioned HTML documents. Their only practical image transport for a
worker is to place a `data:image/...;base64,...` string in the `weave_ticket_artifact_put` input,
which makes a model/tool-call boundary part of the binary transport. The daemon already has a safe
server-side file attachment path for `weave_human_send`: it canonicalizes paths against explicit
roots, rejects `.git` and oversized files, stores bytes under generated names, and uses the workspace
attachment directory outside static content. Ticket attachments should build on those primitives,
not create a second path policy.

## Goals / Non-Goals

**Goals:**

- Let workers attach existing files by path and receive byte size plus SHA-256 evidence.
- Make attachment bytes persistent, ticket-scoped, authenticated, and visible to both human ticket
  reviewers and the weaver's ticket read.
- Prevent partial/orphaned storage and reject malformed or truncated embedded raster image data URIs
  before artifact writes.
- Preserve the existing artifact revision/read-back security boundary and existing chat attachment
  behavior.

**Non-Goals:**

- Raising the artifact HTML size limit or trying to make model-generated base64 reliable.
- Letting agents upload arbitrary client bytes, attach files outside the current outbound allowlist,
  or use ticket attachments as a general workspace file browser.
- Making artifact bodies readable through `weave_ticket_document_get`; ticket attachments are a
  separate, review-oriented binary channel.

## Decisions

### Reuse outbound path validation, with a ticket-owned metadata table

The new tool will call the existing realpath/allowlist/`.git`/size checks from
`threads/outboundAttachments.ts`, then read the validated file once and persist it under the existing
workspace attachment directory with a generated storage key. A new `ticket_attachments` table will
hold ticket id, storage key, display label, media type, byte size, SHA-256, and timestamps. The ticket
foreign key makes cross-ticket lookup impossible, while the generated key and display-only label keep
filenames out of filesystem paths. The DB insert and file write will be coordinated so a failure
cleans up the just-written file and never leaves a row that points at missing bytes.

The tool will resolve media type from the sanitized filename using the existing outbound mapping;
images retain their image media type for inline rendering and unknown types remain downloadable
binary files. The existing outbound per-file cap remains the ticket cap, so a screenshot larger than
the model transport can still pass without changing the established security limit.

### Return integrity metadata and expose bounded review content

The tool response and ticket detail metadata will carry the generated id, URL, label, media type,
byteSize, and SHA-256. This gives the producer a direct, deterministic check without granting agent
HTTP access to human-only routes. `weave_ticket_get` will include attachment metadata and add MCP image
content for image attachments; non-image files remain metadata/download records rather than being
injected wholesale into the model context. The same metadata is added to the authenticated HTTP ticket
detail response, and the UI renders images as thumbnails with a download action.

### Keep the human-only serving boundary

The attachment route will live under the ticket route family, use the same operator-session boundary
as raw artifacts, scope its lookup by `(ticketId, attachmentId)`, and set `Content-Type`,
`Content-Length`, `Content-Disposition`, and `X-Content-Type-Options: nosniff` from stored metadata.
Run-token requests remain blocked by the existing route authentication gate. No attachment directory
is served statically.

### Validate image data URIs structurally before artifact storage

Artifact validation will scan embedded base64 raster image data URIs, reject non-canonical base64
(including a length not divisible by four or characters outside the base64 alphabet), decode bytes,
check the declared type against the existing image signatures, and perform format-aware completeness
checks: PNG chunk lengths and IEND, JPEG end marker, GIF trailer, and WebP RIFF length. The validator
will report the occurrence/nearby HTML context of the failing image. This catches a payload that has a
valid signature but was truncated, without making the artifact body readable to agents or changing
the existing sandboxed artifact serving route.

## Implementation Areas

- `packages/db/src/migrations/`: add `ticket_attachments` metadata schema and ticket index.
- `packages/core/src/threads/attachmentStorage.ts` and `packages/core/src/tickets/`: hash/storage
  helpers and ticket attachment service methods with cleanup/transaction handling.
- `packages/server/src/tools.ts`, `packages/shared/src/tools.ts`: register and describe the new
  common worker tool; include attachment metadata and MCP image content in ticket reads.
- `packages/server/src/routes/tickets.ts`: add ticket attachment metadata to detail and a human-only
  bytes route.
- `packages/ui/src/api/types.ts`, hooks, and `packages/ui/src/v2/ticket/`: load and render attachment
  thumbnails/downloads, invalidating ticket detail after a new attachment.
- `packages/server/test/integration.test.ts`, core ticket/storage tests, and UI ticket tests: cover
  real PNG round trips, allowlist/security, malformed artifact data URIs, serving, and rendering.

## Risks / Trade-offs

- Returning every attached image as MCP content can increase a ticket-read result. Keep the tool's
  image content bounded by the existing per-file cap and metadata-only behavior for non-images; if a
  future ticket needs pagination, add it without weakening the binary storage contract.
- Structural raster checks are deliberately stricter than a leading magic-byte check, so an unusual
  but browser-tolerated image may need to be attached by path instead of embedded in artifact HTML.
- Existing artifact revisions are not rewritten. The new validation applies to future publishes; a
  previously stored corrupt revision remains available to humans for historical audit.

## Migration Plan

Add the nullable-independent `ticket_attachments` table in a forward-compatible migration. Existing
artifact rows and chat attachment rows remain unchanged. Deploy the server and UI together so the
metadata route and viewer agree; no backfill is needed because attachments are new records and old
artifact bodies are intentionally not revalidated.
