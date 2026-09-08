## Why

Captain (2026-09-08): "I should be able to attach documents/files (including images), both with a
browse button and with a direct paste in the conductor chat." Today there is no attachment path at
all — the composer is a bare textarea (`packages/ui/src/components/Composer.tsx`) and the only upload
anywhere is one-shot audio transcription (`packages/server/src/routes/daemon.ts:167`), which stores
nothing and reaches no runtime. The value of a pasted screenshot is entirely in the conductor seeing
what captain sees, not in a filename landing in storage — so this cannot be built as a generic
"upload" feature without first proving the runtime can actually be shown the bytes.

## The transport question, settled

Read out of the installed `claude` binary's own strings (never executed, per the runtime-credential
rule — same method ADR 0012/VS-99 used): the CLI's interactive paste-image feature builds and sends
exactly the Anthropic Messages API image content block —
`{type:"image",source:{type:"base64",media_type,data}}` — and an MCP tool result carrying an
`ImageContent` block (`{type:'image', data, mimeType}`, present in the installed
`@modelcontextprotocol/sdk@1.30.0` types) is converted by the CLI into that same block on a
`tool_result`. Full evidence in `design.md` — Context.

So: **images reach the conductor as real vision input, delivered through the `ac_inbox` MCP tool
result the conductor already calls every turn** — not through the turn's prompt text (which, per the
existing `human_message` wake path, never carries more than a truncated reason line anyway). Plain
text documents are inlined as text in that same tool result. Nothing else — PDFs, other binary
documents — has an evidenced delivery path today, so this change refuses them server-side rather than
storing them and pretending the conductor read them.

## What Changes

- A `POST /threads/:id/messages` sent as `multipart/form-data` may carry up to 4 files alongside the
  text body, sent together in one request (no separate "upload" step, so there is never an orphaned
  upload to garbage-collect). The existing `application/json` text-only shape is unchanged.
- Accepted types: images (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, ≤5MB each — the same
  cap the CLI's own paste feature imposes) and plain text (`text/plain`, `text/markdown`, ≤256KB
  each — inlined verbatim, so the cap bounds context cost). Anything else is rejected with a clear
  `unsupported_media_type` error before any bytes are stored. Rejected past `Content-Length` before
  the body is read where the size alone already disqualifies it.
- Attachments are stored on disk under the workspace state directory (`<workspace
  root>/.agent-conductor/attachments/`, alongside `runs/` and `runtimes/` — never under anything
  `packages/ui`'s dist serves), named by a server-generated id, never by the client's filename.
  Served back only through an authenticated, thread-scoped route
  (`GET /threads/:id/attachments/:attachmentId`).
  **BREAKING**: none — this is new surface area.
- `ThreadMessage.parts` gains an `attachment` part (id, filename, mediaType, byteSize) so the
  transcript can render a thumbnail/chip; it survives a reload because it is read back with the
  message exactly as reply references already are.
- The `human_message` wake payload carries attachment metadata; `ac_inbox`'s handler resolves each
  referenced attachment and returns image bytes as a real MCP `image` content block and text
  documents inlined as text, alongside the existing JSON. This is a new, additive field on
  `ToolResult`'s success branch (`mcpContent?`), consumed once, at the single site that already turns
  a tool result into the MCP `CallToolResult` (`packages/server/src/mcp.ts`).
- Attachments on a thread bound to a ticket (comment path) are rejected — out of scope per the
  ticket, and that path has no wake payload to carry metadata through anyway.
- The composer (`packages/ui`) gains a browse control and paste handling; pasting an image is the
  primary path and is exercised as such in tests.

## Capabilities

### New Capabilities

- `conductor-chat/message-attachments`: attaching a file to a conductor chat message by browsing or
  pasting, its storage and safe serving, its delivery to the conductor as real content (not a
  reference), and its retention.

### Modified Capabilities

(none — no existing capability's requirements change; `conductor-chat/message-reply-reference` and
the other `conductor-chat/*` capabilities are unaffected by this addition)

## Impact

- **DB**: new `attachments` table (migration `packages/db/src/migrations/0019_attachments.sql`),
  referencing `thread_messages(id)`.
- **Core**: `packages/core/src/threads/service.ts` (`inbound`, wake payload), a new attachment
  storage module, `packages/shared/src/errors.ts` (`ToolResult` gains `mcpContent?`).
- **Server**: `packages/server/src/routes/threads.ts` (multipart handling, size/type gates, the
  serving route), `packages/server/src/mcp.ts` (content-array construction), `packages/server/src/
  tools.ts` (`ac_inbox` handler).
- **UI**: `packages/ui/src/components/Composer.tsx` (browse + paste), the message-bubble/transcript
  component (attachment rendering), `packages/render` (a pure view-model function for the new part
  type, per the package's existing convention).
- **Docs**: `docs/API.md` (the two new/changed routes), a new ADR recording the CLI-strings evidence
  (pattern: `docs/adr/0012-claude-turns-run-on-stream-json-stdin.md`).
- **No change** to `ThreadMessage`'s existing fields, to any other runtime adapter, or to worker/ticket
  messaging.
