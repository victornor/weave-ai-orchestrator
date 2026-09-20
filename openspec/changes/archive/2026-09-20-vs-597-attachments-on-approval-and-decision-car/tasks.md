## 1. Reproduce

- [x] 1.1 Start a scratch daemon (own `--config-dir`, non-7433 port, pid recorded), attach a real MP4, PDF, text file, image and a long parenthesised/`->`/non-ASCII-label file; fetch each with curl (GET, HEAD, Range, If-None-Match), and with a phone-width headless browser and a TLS reverse proxy; record the evidence and the cause of "Check internet connection" (or what could only be narrowed) for the PR

## 2. Shared detection and serving

- [x] 2.1 `@weave-ai/shared`: `detectAttachmentMediaType`, `attachmentDownloadName`, extended extension table and `guessOutboundMediaType`, with unit tests (mp4, webm, pdf, zip, mp3, octet-stream override only, no html/svg)
- [x] 2.2 `packages/server/src/attachmentResponse.ts` `serveBytes` (200/206/304/416/HEAD, length from bytes, disposition, ETag, nosniff), with route-level tests
- [x] 2.3 Ticket and thread attachment routes call `serveBytes`; tests for length-equals-bytes, hostile and non-ASCII labels, octet-stream detection, Range, HEAD
- [x] 2.4 `putAttachment` and the outbound `weave_human_send` path store the detected media type; tests

## 3. UI

- [x] 3.1 `attachmentKind` in `@weave-ai/render`; `useAttachmentDownload` hook (fetch→blob→save, error, retry)
- [x] 3.2 Shared `AttachmentItem` (video/audio inline with controls and download, PDF/text new tab, image preview/overlay, other download, error and Retry) with component tests for each kind and the failed-download state
- [x] 3.3 Use it in `TicketEvidence`, the ticket page `AttachmentsSection` and chat `AttachmentRows`; update their tests

## 4. Evidence and delivery

- [x] 4.1 Rendered screenshots in every theme at desktop and phone width (playable video, non-media file, failed download with error and Retry), stored outside `work/` and attached to the ticket
- [x] 4.2 Run typecheck, lint and one full suite at a time with `--maxWorkers=4`; paste both suite blocks verbatim in the PR; open the PR
