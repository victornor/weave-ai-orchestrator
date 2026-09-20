## Context

Findings from reading the code (2026-09-20; reproduction is task 1 of apply and its result goes in the PR):

- `routes/tickets.ts` `GET /:id/attachments/:attachmentId` sends `content-length` from stored `byteSize`, a hand-rolled `content-disposition` (quotes/CRLF only; Node throws `ERR_INVALID_CHAR` on a non-Latin-1 label), no Range, no HEAD-specific handling, no ETag. `routes/threads.ts` was fixed by VS-528 (`attachmentContentDisposition`, length from bytes) but also lacks Range/ETag.
- `putAttachment` stores `guessOutboundMediaType(source)`, whose table has only png/jpg/gif/webp/txt/md, so an MP4 is `application/octet-stream`; with `nosniff` and a label with no extension a phone has nothing to open it with. The VS-593 label ("Rendered fast-1080p output (720p 24fps source -> 1920x1080, audio kept)") also contains `>`, `(`, `,`.
- The card (`TicketEvidence`) renders any non-image as `<a download={label}>` straight at the tailnet URL: no video, no error state, no retry.
- Hypotheses for "Check internet connection" after the download starts, to be confirmed or eliminated by reproduction: (a) Chrome's Android download manager re-requests with `Range` on resume/for media and the route ignores it, returning 200 with full length; (b) `octet-stream` with no extension makes Chrome hand the response to the download manager, which re-fetches without the page's session context; (c) a length/body mismatch through the TLS proxy. The plan does not assume which; the ranged, correctly typed, named response plus the fetch-to-blob path removes all three. If reproduction cannot show the failing request, the PR says so and names what the owner should check on the phone (the request the download manager makes, via Chrome's `chrome://net-export` or the daemon access log).

## Decisions

1. **`serveBytes(request, {bytes, mediaType, filename, etag?})`** in `packages/server/src/attachmentResponse.ts` builds the whole response (200/206/304/416, HEAD). Ticket and thread routes call it; there is no other place that sets attachment headers. Hono's `app.get` also answers HEAD, so the helper drops the body when the method is HEAD.
2. **Detection** in `@weave-ai/shared` `attachments.ts`: `detectAttachmentMediaType({stored, filename, bytes})` sniffs magic bytes (png/jpeg/gif/webp existing, plus mp4/mov `ftyp`, webm/mkv EBML, pdf `%PDF`, zip `PK`, mp3 `ID3`/frame sync, ogg, wav `RIFF…WAVE`) then falls back to extension, and only overrides a stored `application/octet-stream` (a specific stored type is trusted, as VS-133 verifies inbound types). `attachmentDownloadName(label, mediaType)` appends the type's extension when the label lacks one. `guessOutboundMediaType` is extended with the same extension table so storage and serving agree.
3. **ETag** is `"<sha256>"` from the row (ticket) or a hash of the served bytes (thread rows lacking one). Attachment bytes are immutable, so `Cache-Control: private, max-age=3600` alongside.
4. **No stored-row migration**: existing octet-stream rows are corrected at serve time.
5. **UI**: a single `AttachmentItem` in `components/` (props: url, name, mediaType, byteSize, createdAt) with a `useAttachmentDownload` hook (fetch → blob → `a[download]` click via object URL, states idle/busy/error, Retry). `TicketEvidence`, the ticket page `AttachmentsSection` and chat `AttachmentRows` all render it, so none keeps a bare link. Images keep the existing preview/overlay; kind detection lives in `@weave-ai/render` (`attachmentKind`) so chat and cards agree.
6. Video/audio elements use the direct URL as `src` (needs Range, which the route now supports) and the blob path only for the Download button and its retry.

## Audit: every place an attachment or downloadable link is rendered

| Place | Today | After |
|---|---|---|
| `components/TicketEvidence.tsx` (plan/merge/action cards, both card implementations `components/DecisionCard.tsx` and `v2/DecisionCard.tsx`) | image overlay; other = bare `<a download=label>` to the ticket route | `AttachmentItem`, ticket route via `serveBytes` |
| `v2/ticket/Ticket.tsx` `AttachmentsSection` | card link `target=_blank` to ticket route, image preview only | `AttachmentItem` |
| `v2/ChatMessage.tsx` `AttachmentRows` (chat, plan tab via same view) | image link, other = bare `<a download>` to thread route (VS-528 headers, no Range) | `AttachmentItem`, thread route via `serveBytes` |
| `v2/artifact/Artifact.tsx`, `v2/knowledge/*`, `ArtifactViewer` | artifact HTML: `text/html` `c.text` at `/artifacts/:key/raw`, downloaded by fetch→blob (already the reliable path) | unchanged; not stored bytes. Routes keep their CSP |
| `routes/tickets.ts` `/:id/artifacts/:key/raw`, `routes/artifacts.ts` `/:key/raw` | text body, CSP | unchanged (documents, not attachments) |
| `routes/tickets.ts` `/:id/documents/*` | JSON | unchanged |
| Knowledge documents | no binary attachments exist in the data model | nothing to change |
| Decision cards (`DecisionCard`) | show ticket evidence for plan/merge/action kinds only (`EVIDENCE_KINDS`); other kinds show none | unchanged set; they use the shared item where they list evidence. Decision-card links to artifacts/PRs are navigation, not downloads |
| Outbound Telegram/channel attachment sends | push bytes via the channel API | unchanged (media type improves via detection) |

No other route serves attachment bytes; the plan lists them so a future one is added through `serveBytes`.

## Risks / Trade-offs

- Sniffing must never widen what is trusted inbound: it only refines `application/octet-stream` for serving and outbound storage; the inbound multipart type allowlist is untouched.
- Serving `video/mp4` inline under `nosniff` from the app origin is safe: stored files are never `text/html` or `image/svg+xml` (detection never yields either; those remain forced to `attachment` disposition).
- Rendered evidence needs a real browser; done against a scratch daemon (own config dir, port not 7433), screenshots kept outside `work/` and attached to the ticket.
