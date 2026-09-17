## Why

Captain reported that a bundled zip attachment (`vs527-apply-these.zip`) never downloaded from the
chat — seven consecutive attempts failed with Chrome's "Check internet connection" — while a
single-file attachment from the same thread downloaded fine. Investigation at HEAD could not
reproduce it: the zip is built and stored at send time, the route returns 200 with a `Content-Length`
equal to the bytes delivered, the archive passes `unzip -t`, and real Chromium downloads it (direct
navigation, via `<a download>`, and with the service worker registered). The strongest fit for the
evidence is browser per-origin connection starvation under heavy live-view use — the VS-227/VS-417
class, already fixed by VS-509 but not yet in the running release.

Two fragilities in the serving path are worth removing regardless of cause. The response declares
`Content-Length` from the attachment row's stored `byte_size` rather than from the bytes it actually
reads, so a stored size that ever disagrees with the file would make the daemon promise more than it
sends — exactly the "transfer ended before the browser expected" symptom reported. And the route
sends no `Content-Disposition`, unlike the ticket-attachment route, leaving the browser to infer the
download from the UI's `download` attribute alone.

## What Changes

- The chat attachment serving route (`GET /threads/:threadId/attachments/:attachmentId`) declares its
  `Content-Length` from the bytes it actually reads, never from the stored `byte_size`.
- The route sends a `Content-Disposition` header: `inline` for images, `attachment` with the
  attachment's display filename for everything else. This matches the ticket-attachment route, and a
  non-ASCII filename is carried in the RFC 5987 `filename*` form so a unicode name never produces an
  invalid header.
- Adds the end-to-end test that a **bundled zip** attachment of several files downloads through the
  route with the correct bytes and headers — the case VS-273 shipped without one.

## Capabilities

### New Capabilities

<!-- None: this change hardens an existing capability, it introduces no new one. -->

### Modified Capabilities

- `conductor-chat/message-attachments`: the serving requirement is tightened — the response's declared
  length always equals the bytes actually served, and a non-image attachment is served as a named
  download rather than with no disposition at all.

## Impact

- `packages/server/src/routes/threads.ts` — the attachment serving route.
- `packages/shared/src/attachments.ts` — a small disposition-header helper and its unit test.
- `packages/server/test/threads-attachments.test.ts` — the bundled-zip download test that was missing.
- `docs/API.md` — the serving route's response headers.
