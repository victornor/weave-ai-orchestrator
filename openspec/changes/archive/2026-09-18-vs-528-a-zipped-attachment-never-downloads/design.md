## Context

See `proposal.md` — Why. The serving route is
`packages/server/src/routes/threads.ts:58`:

```ts
return new Response(bytes, { headers: {
  'Content-Type': attachment.mediaType, 'Content-Length': String(attachment.byteSize),
} });
```

Established while investigating VS-528 (recorded on the ticket, `investigation`):

- The zip is built and stored at send time (`resolveOutboundAttachments` → `buildZip` →
  `writeGeneratedAttachment`); nothing is built at download time.
- Through the real `@hono/node-server` adapter the response is 200 with
  `Content-Length` exactly equal to the body (8898/8898) for a two-file zip, and equal for a size
  matrix from 4 KB to 1 MB, single files and zips alike. The archive passes `unzip -t`.
- Real headless Chromium downloads the zip by direct navigation, by `<a download>` from a page, and
  with `packages/ui/public/sw.js` registered and controlling the page.
- The only reproducible blocker is the browser's per-origin HTTP/1.1 budget saturated by SSE
  streams — the VS-227/VS-417 class, fixed by VS-509 (merged 2026-09-17, not in the running release)
  and not zip-specific.

The ticket-attachment route, `packages/server/src/routes/tickets.ts:126`, already sets a
`content-disposition` and derives nothing from a stored size, so it is the in-repo precedent this
route diverges from.

## Goals / Non-Goals

**Goals**

- The declared response length is always what the route actually sends.
- A non-image attachment is served with an explicit download disposition and the human's filename.
- The bundled-zip download path has a test at the HTTP boundary, which it has never had.

**Non-Goals**

- Tracing or fixing the reported failure at captain's machine. It was not reproduced at HEAD, and the
  suspected cause (connection starvation) is already fixed by VS-509 and ships with the next release.
- A diagnostic capture harness — the weaver ruled it out for this ticket.
- Changing the ticket-attachment route, the zip writer, or the attachment storage layout.

## Decisions

### 1. `Content-Length` from `bytes.byteLength`, not `attachment.byteSize`

`readAttachmentBytes` is the only source of the body, so it is the only honest source of the length.
Taking the length from the same value makes the mismatch class the ticket describes impossible by
construction, whatever wrote the row. The stored `byte_size` stays in the row (it is what the message
part reports and what the size byline renders); it simply stops being the response's authority.

Alternative considered: assert `bytes.byteLength === attachment.byteSize` and fail loudly. Rejected —
a served file is not the place to turn a cosmetic metadata drift into a failed download.

### 2. A shared `attachmentContentDisposition(mediaType, filename)` helper

Parity with the ticket route is wanted, but its expression
(`attachment; filename="${label.replace(/["\\\r\n]/g, '_')}"`) 500s on a non-ASCII label: Node's
`writeHead` throws on a header value with characters outside Latin-1. Chat attachments can carry
unicode display names (a human's pasted `résumé.md`), so copying that expression would ship a
regression the ticket route does not currently exercise. The helper returns `inline` for image media
types, and otherwise `attachment; filename="<ascii-fallback>"; filename*=UTF-8''<pct-encoded>`, where
the fallback replaces characters outside `\x20`–`\x7e` plus `"` and `\` with `_`. It lives in
`packages/shared/src/attachments.ts` beside the other attachment policy functions and is unit-tested
there.

Alternative considered: inline the ticket route's expression. Rejected for the unicode 500 above.

### 3. Test at the route/HTTP boundary, not the unit level

The reported symptom is an HTTP transfer, so the test fetches a bundled zip through
`GET /threads/:threadId/attachments/:attachmentId` and asserts status, `content-type`,
`content-length` equal to the body length, the disposition header, and that the body is byte-identical
to the stored archive. The existing `threads-attachments.test.ts` already wires the real
`createThreadsService` and the app, so the new cases extend it. Archive validity itself is already
covered by `packages/core/src/threads/zip.test.ts`; this test locks the download path, not the writer.

## Risks / Trade-offs

- **[Risk]** The disposition header could change how a browser names a download where the UI's
  `download` attribute is also present. → **Mitigation**: the `download` attribute still wins in the
  browser; the header is the fallback the ticket route already relies on.
- **[Risk]** A behavior change with no reproduction means the change may not fix the reported failure.
  → **Mitigation**: the proposal and the PR state plainly that the failure was not reproduced at HEAD
  and that the suspected cause is connection starvation fixed by VS-509; the change is defensive and
  removes a class of doubt.
- **[Trade-off]** Not touching the ticket route leaves its non-ASCII header bug in place. Accepted:
  out of this ticket's scope; worth a separate follow-up if it ever bites.

## Migration Plan

None. Route-only behavior; no schema, data, or config change. Rollback is reverting the commit.
