## 1. Ticket attachment storage and integrity

- [x] 1.1 Add the ticket-attachment migration, shared metadata type, SHA-256 calculation, and
      generated-file storage/cleanup helpers.
- [x] 1.2 Add core ticket-service methods to validate an allowed path, persist metadata atomically,
      list attachments, and read bytes only when the ticket id matches.
- [x] 1.3 Add core tests for a real PNG round trip, byte size/checksum, path allowlist, `.git` and
      size rejection, cross-ticket lookup, and no orphan after a failed write.

## 2. Agent and HTTP interfaces

- [x] 2.1 Register `weave_ticket_attachment_put` for worker/common tools with ticket write scope;
      return id, URL, label, media type, byte size, and SHA-256 without accepting bytes in input.
- [x] 2.2 Add attachment metadata to ticket reads and an image MCP content block for
      `weave_ticket_get`; add the human-authenticated ticket attachment route with inline image and
      download behavior.
- [x] 2.3 Add server integration tests for tool success, checksum/size response, route rendering,
      authentication, cross-ticket rejection, and a real PNG large enough to cover the old failure.

## 3. Artifact data-URI validation

- [x] 3.1 Implement strict base64 image-data-URI parsing and format-aware completeness checks, with
      errors naming the failing occurrence/context.
- [x] 3.2 Gate artifact publishing on that validator and add regression tests for complete and
      truncated/malformed PNG data URIs, asserting no revision/work product is written on failure.

## 4. Ticket UI and delivery

- [x] 4.1 Add API types/hooks and render ticket attachments as image previews with labels, sizes,
      and download links; cover loading and empty states in UI tests.
- [x] 4.2 Run typecheck and both test suites, update agent-facing/API docs and relevant project
      knowledge, tick all tasks, commit the implementation, and deliver the branch for review.
