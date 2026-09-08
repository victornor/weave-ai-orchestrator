## 1. Data model

- [x] 1.1 Add migration `packages/db/src/migrations/0019_attachments.sql`: `attachments` table
      (`id`, `thread_id` REFERENCES `channel_threads(id)`, `message_id` REFERENCES
      `thread_messages(id)`, `filename`, `media_type`, `byte_size`, `storage_key`, `created_at`) plus
      an index on `message_id`; verify `pnpm --filter @agent-conductor/db test` passes and the
      migration applies cleanly to a fresh db.
- [x] 1.2 Add `Attachment` type to `packages/shared/src/types.ts` and an `AttachmentPart` shape for
      `ThreadMessage.parts` (`{ type: 'attachment', id, filename, mediaType, byteSize }`); verify
      `pnpm typecheck` is clean.
- [x] 1.3 Define the accepted-type/size policy as exported constants (image types + 5MB cap, text
      types + 256KB cap, 4-file-per-message cap, extension-from-media-type map) in a shared location
      both server and (if needed) tests can import; verify a unit test asserts the exact values.

## 2. Storage

- [x] 2.1 Add an `attachments` directory to `WorkspacePaths` (`packages/core/src/context.ts`),
      following the existing `runs`/`runtimesHome` pattern; verify a unit test asserts the resolved
      path.
- [x] 2.2 Add a storage module (write bytes under a server-generated ULID + policy-derived extension,
      read bytes back by id) that never accepts a caller-supplied path component; verify unit tests
      cover: a write/read round trip, and that a crafted filename never appears in the resulting path.
- [x] 2.3 Add magic-byte sniffing for the four accepted image types (PNG/JPEG/GIF/WebP) (`sniffImageType`,
      `packages/shared/src/attachments.ts`, unit-tested); wired into the upload route's rejection in
      task 3.2, where the declared and sniffed types are compared.

## 3. Upload and send

- [x] 3.1 Extend `POST /threads/:id/messages` (`packages/server/src/routes/threads.ts`) to accept
      `multipart/form-data` (text `body` plus up to 4 `files` parts) alongside the existing
      `application/json` shape, following `daemon.ts`'s `readAudio` content-type branch; verified by
      route tests covering both content types succeeding (`threads-attachments.test.ts`).
- [x] 3.2 Reject a request whose `Content-Length` already exceeds what any accepted combination could
      satisfy, before parsing the body; reject a request with more than 4 files, an unsupported type,
      an oversized file, or a mislabelled image (magic-byte mismatch), each with a response stating
      why; verified by route tests covering all rejection cases and that no attachment row or file
      exists afterward for a rejected request.
- [x] 3.3 Reject an attachment against a thread that is bound to a ticket, before opening the
      transaction, with a `validation` error naming the reason (`threads/service.ts` `inbound` — the
      service-level guard, which the route in 3.1 sits in front of); verified by a service test
      (`threads.test.ts`) covering the rejection and that the text-only ticket-comment path is
      unaffected.
- [x] 3.4 In `threads.inbound` (`packages/core/src/threads/service.ts`), write the message, its
      `attachments` rows, and its `attachment` parts entries in one transaction; verified by a service
      test asserting all three are consistent (message, attachment rows, and `parts`) after a single
      call.
- [x] 3.5 Add attachment metadata (`attachmentIds`) to the `human_message` wake payload; verified by a
      service test asserting the wake payload carries it.

## 4. Serving

- [x] 4.1 Add `GET /threads/:threadId/attachments/:attachmentId` under the existing authenticated
      `/api` router, returning the stored bytes with the stored `mediaType` and `not_found` when the
      attachment's own `thread_id` does not match the URL's `:threadId`; verified by route tests
      covering a matching fetch succeeding, a cross-thread fetch failing, and an unauthenticated fetch
      failing.
- [x] 4.2 Verified with a route test (two separate harnesses = two separate `:memory:` databases,
      exactly as two workspaces are two separate `db.sqlite` files) that an attachment id created in
      one workspace's database is simply absent from another's — the same structural guarantee every
      other workspace-scoped table already relies on.

## 5. Delivery to the conductor

- [x] 5.1 Add an optional `mcpContent` field to `ToolResult`'s success branch
      (`packages/shared/src/errors.ts`), plus a `withMcpContent`/`isWithMcpContent`/`mcpContentOf`
      escape hatch so a `ToolDef.handler` can set it through `runTool`'s uniform `ok(...)` wrapping;
      `pnpm typecheck` clean, every existing `ok(data)` call site unaffected (optional param).
- [x] 5.2 In `packages/server/src/mcp.ts`'s `CallToolRequestSchema` handler, append
      `result.mcpContent` (when present) to the `content` array sent back over MCP; verified by
      `mcp.test.ts` (VS-133 block): a handler setting it produces a multi-block `content` array, one
      that does not produces exactly the one text block (no regression, and pinned for every other
      existing tool in the suite).
- [x] 5.3 In `ac_inbox`'s handler (`packages/server/src/tools.ts`, `attachmentsForWake`), each
      `human_message` entry's attachment ids are resolved: an image's bytes go into `mcpContent` as
      `{type:'image', data: base64, mimeType}`, a text document's decoded content is inlined into that
      entry's JSON, and a deleted/unreadable attachment is dropped rather than failing the call.
      Verified end to end in `mcp.test.ts`.

## 6. Composer and transcript (web app)

- [x] 6.1 Add a browse control to `packages/ui/src/components/Composer.tsx` (file input, filtered to
      the accepted types) that adds a selected file to pending-attachment state; verified by a
      component test (`components.test.tsx`) covering selecting a file producing pending-attachment
      state, plus client-side rejection of a disallowed type and the 4-file cap, both with a message.
- [x] 6.2 Add clipboard paste handling to the composer that adds a pasted image to the same
      pending-attachment state; verified by a component test covering pasting an image producing the
      same state browse produces, and confirming paste is a no-op when `allowAttachments` is unset.
- [x] 6.3 Wire `Chat.tsx`'s send path (`usePostThreadMessage`) to submit pending attachments as
      `multipart/form-data` together with the text, and to leave the composer's text and pending
      attachments intact (with a toast) when the send fails for any reason — attachments are a
      controlled prop on `Composer`, cleared by the parent only once the send is confirmed. Verified
      by component tests covering a resolved send clearing both, and a rejected send leaving both
      exactly as they were.
- [x] 6.4 Added `attachmentPartsOf`/`attachmentToView` in `packages/render/src/attachments.ts` (plus
      `formatBytes` in `format.ts`), turning an opaque `parts` entry into `{kind: 'image'|'text'|
      'other', filename, sizeLabel, ...}`, per the package's existing convention; unit-tested for both
      kinds and for malformed/absent parts.
- [x] 6.5 `Chat.tsx`'s `ChatMessage` renders an `AttachmentGallery`: a thumbnail `<img>` for an image
      part, a filename chip with a `download` link for a text part, both pointing at the serving
      route — no token plumbing needed since the browser's own session cookie covers a same-origin
      `<img src>`. Verified by a component test asserting both render forms; the transcript always
      renders from `messages.data` (there is no separate optimistic path), so the same test covers a
      freshly-sent message and a reloaded one — both read the identical `parts` shape.

## 7. Cross-cutting verification and docs

- [x] 7.1 Added a genuine end-to-end test (`threads-attachments.test.ts` — "end to end") that sends a
      real `multipart/form-data` message with one image attachment through the real HTTP route, the
      real `threads.inbound`, a captured (not hand-copied) wake payload, and a real MCP client calling
      `ac_inbox` — asserting the tool result's `content` array contains a real `image` block whose
      `data` matches the sent bytes exactly. Closes the loop the ticket's own investigation opened.
- [x] 7.2 Added `docs/API.md` entries: the multipart shape and its limits on
      `POST /threads/:id/messages`, the new `GET .../attachments/:id`, and a note on the MCP section
      about `ac_inbox`'s image content blocks. Also added the `attachments` table to `docs/PLAN.md`'s
      data model (§ the channels/threads row), pointing at the ADR for the delivery mechanism.
- [x] 7.3 Wrote `docs/adr/0015-attachments-reach-the-conductor-through-ac-inbox.md`, recording the
      CLI-strings evidence for image/MCP content delivery, following ADR 0012's pattern (evidence
      table, why the prompt itself was never a candidate, and stating plainly that none of it is
      verified against a live CLI, by rule).
- [x] 7.4 `pnpm lint && pnpm typecheck && pnpm test` all green (130 core test files / 1725 tests + 57
      ui test files / 970 tests, 1 pre-existing unrelated skip). What the conductor receives and the
      limits enforced are stated in the PR description.
