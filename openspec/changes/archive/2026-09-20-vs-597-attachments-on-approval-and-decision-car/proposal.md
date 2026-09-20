## Why

Captain still cannot download some attachments from approval and decision cards (2026-09-20: the VS-593 merge card's MP4 starts downloading on a phone, then Chrome reports "Check internet connection" with a Resume button). The file is valid; delivery fails. "Still" means a recurring class of failure: VS-528 fixed the thread attachment route but the ticket-attachment route was never brought onto the same path, and the card renders every non-image as a bare `<a download>`, so video is never playable and a failed download is silent.

## What Changes

- One shared serving helper for every stored-bytes attachment route: length from the served bytes, RFC 5987 `Content-Disposition` via `attachmentContentDisposition`, a filename extension derived from the media type, media type detected from bytes/extension when stored as `application/octet-stream`, `Accept-Ranges: bytes` with 206/416 and HEAD, and a stable ETag/304.
- `weave_ticket_attachment_put` (and the outbound `weave_human_send` path) set the media type from extension and magic bytes, so `.mp4` is stored `video/mp4` (today `guessOutboundMediaType` has no video, audio, pdf or json entries and everything falls back to octet-stream). Existing octet-stream rows are corrected at serve time by the same detection.
- UI: one shared attachment item used by plan, merge, action and decision cards, the ticket page and chat: `video/*` and `audio/*` play inline (`<video controls playsinline preload="metadata">`) with a download button; PDF and text open in a new tab; everything else downloads. Download is fetch-to-blob-and-save when the direct link is unreliable, with a visible error and Retry, never silent.
- Reproduce first (real route, curl with/without Range, HEAD, phone-width browser, a TLS reverse proxy) and report the evidenced cause of the phone failure, or say plainly what could only be narrowed.

## Capabilities

### New Capabilities
- `attachment-serving`: how the daemon serves stored attachment bytes and how the web app presents and downloads them.

### Modified Capabilities
None (the existing `ticket-attachments` and `message-attachments` specs keep their storage/acceptance rules; serving and presentation move to the new capability).

## Impact

`packages/shared/src/attachments.ts` (detection, extension map, filename helper), `packages/server/src/routes/tickets.ts` and `threads.ts` (shared serve helper, new `serveBytes`), `packages/core/src/tickets/service.ts` (`putAttachment` media type), `packages/core/src/threads/outboundAttachments.ts`, UI `components/TicketEvidence.tsx`, `v2/ChatMessage.tsx`, `v2/ticket/Ticket.tsx`, `v2/DecisionCard.tsx`/`components/DecisionCard.tsx` (consumers), tests for each. No schema migration.
