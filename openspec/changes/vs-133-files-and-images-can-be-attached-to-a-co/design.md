## Context

The ticket requires settling one unknown before any design: can the runtime the conductor uses put an
image or a document in front of the model at all, and by what mechanism — established from the CLI's
own interface, never by launching it against a live session (the runtime-credential rule, violated
once already on 2026-09-07: a live invocation rotates the daemon's shared OAuth refresh token out from
under every agent).

### What runtime the conductor uses

`packages/core/src/models/resolve.ts:4-17` — there is one workspace-level setting,
`models.conductor.runtime`, defaulting to `claude` (`packages/shared/src/config.ts:99`). Roles carry
no runtime of their own (`packages/core/src/roles/roles.test.ts:59,85,102-104` — a patch attempting to
set one is refused). So a given workspace's conductor is pinned to one runtime; today, and in every
workspace observed, that runtime is Claude. This design covers Claude only, per the ticket's own
instruction 3: if a runtime cannot do this, say so rather than build for it. Codex, Gemini and OpenCode
are not investigated here because nothing in this ticket needs them to be — if a workspace ever points
its conductor at one of them, an attachment would fall back to metadata-only with a stated reason,
exactly as VS-99's `describeLiveInput` pattern already does for live input on those same three
runtimes.

### Evidence: the Claude Code CLI's own strings (read as a file, never executed)

Read from `/home/user/.local/share/mise/installs/claude/latest/claude` (2.1.258 — the same binary and
method ADR 0012/VS-99 used, `strings -a` piped to a scratch file, never `exec`'d):

| Fact | Evidence |
|---|---|
| A `user` frame's `message.content` is the Anthropic Messages API shape (string \| content-block array) | Already established by ADR 0012: `events.ts` distinguishes an echoed string-content `user` frame from array-content tool results. This change relies on the array form for a *fresh* user frame having no reason to be treated differently — but see Decision 1: this change does **not** use the stdin `user` frame at all, for reasons below. |
| The CLI's own interactive paste feature builds a real image content block | `{block:{type:"image",source:{type:"base64",media_type:fOe(d),data:d.toString("base64")}}, ...}` and, at the UI layer, `{id:Ur,type:"image",content:zn,mediaType:Xn?.mediaType\|\|"image/png",filename:Xn?.filename\|\|"Pasted image", ...}` — this is literally the CLI's "Pasted image" clipboard feature, confirming paste-to-vision is a real, shipped path in this binary, not a hypothetical one. |
| Its own image-attachment size/dimension caps | `var UA={maxWidth:2000,maxHeight:2000,maxBase64Size:5242880}` — 5MB base64, 2000×2000. |
| MCP `tool_result` → image content block | `return{tool_use_id:n,type:"tool_result",content:[{type:"image",source:{type:"base64",media_type:o,data:r.data}}]}` — an MCP tool result whose content included an image is turned into this exact `tool_result` block. This is the mechanism this change uses. |
| PDFs get a distinct `document` block, not `image` | `{type:"document",source:{type:"base64",media_type:"application/pdf",data:p.base64}}` — evidenced only for the CLI's own internal `Read` tool handling a local PDF path, never for anything arriving over MCP. No string anywhere shows an MCP `resource` or other content item being turned into a `document` block. |
| Plain text has no block type of its own | Every non-image, non-PDF file read by the CLI's own tools becomes a `{type:"text",...}` block — confirming the ticket's own guess (instruction 2) that a text document's answer is "include it as text." |

Separately, `packages/server/src/mcp.ts:25-31` (found by direct read, not string-reading — this is our
own code) shows the daemon's MCP server already speaks the SDK version that types this:
`@modelcontextprotocol/sdk@1.30.0`'s `types.d.ts` declares `ImageContentSchema` (`type:"image"`,
`data`, `mimeType`) as a member of `CallToolResultSchema`'s `content` union. Nothing in our own MCP
layer uses it yet — every tool result today is a single hardcoded `{type:'text', text:
JSON.stringify(result)}` block (`mcp.ts:27`).

**Conclusion:** images reach the conductor as real vision input by returning an `image` MCP content
block from a tool call. Plain text documents are inlined as `text`. PDFs and any other binary format
have no evidenced delivery path through anything this daemon controls, and are refused server-side
(ticket's own instruction 3: refusing honestly is acceptable, storing-and-pretending is not).

### Why the delivery point is `ac_inbox`, not the turn's stdin frame

Traced in full (`packages/server/src/routes/threads.ts:22-24` → `packages/core/src/threads/
service.ts:136-174` (`inbound`) → `packages/core/src/runs/engine.ts:210-214` → `packages/core/src/
prompts/index.ts:192-200,237-251` (`buildTurnPrompt`/`flattenWakes`) → `engine.ts:262-279`): a human
message never reaches `TurnInput.prompt` as more than a short "message from X" reason line.
`flattenWakes` renders only `w.reason`; the full body (truncated to 2000 chars) sits in the wake's
`payload`, which the agent is expected to read with `ac_inbox` — the tool it already calls first,
every turn (its own description says so). There is therefore no existing path where attaching content
to the *prompt* would even be seen; the only path a human message's content reaches the model at all is
through `ac_inbox`'s tool result. Putting the attachment there, rather than reshaping the prompt
builder, is not a stylistic choice — it is the only path that already exists.

### Why not the stdin `user` frame (VS-99's channel)

VS-99 built a live `send()` channel on `TurnHandle`, used only for a human *attaching mid-turn*
(`workers.message(..., {live: true})`). A chat message with an attachment goes through the ordinary
wake path (`threads.inbound`), not the live-attach path, and reusing `send()` here would mean racing
delivery against whether a turn happens to be executing at that instant — the live channel is opened
per-turn and closed on `result` (ADR 0012), so "send an image frame" would silently degrade to nothing
whenever no turn is running, which is most of the time a chat message arrives. `ac_inbox` has no such
timing dependency: it is read at the start of the turn the wake caused.

## Goals / Non-Goals

**Goals:**

- A file can be attached by browsing or pasting, in one request with the message text, so a failed
  send never drops one and never leaves an orphaned upload to clean up.
- An image the conductor receives is a real content block the model can see, not a filename.
- Explicit, server-enforced, evidence-based limits: a size the CLI's own paste feature already accepts
  without complaint, a narrow accepted-type allowlist, and an honest rejection for anything else.
- Storage that cannot become a path-traversal or static-serving bug by construction.

**Non-Goals:**

- PDFs or any other binary document type — no evidenced delivery path (see Context).
- Attachments on a ticket-bound thread, on worker messages, or through Telegram — out of scope per the
  ticket, and (for ticket-bound threads) there is no wake payload to carry metadata through today
  anyway (`threads/service.ts:156-158`: a ticket-bound thread's message becomes a ticket comment, not a
  wake).
- OCR, thumbnails, or any processing beyond what the transcript needs to show the attachment exists.
- A runtime other than Claude (see "What runtime the conductor uses").

## Decisions

### 1. One multipart request carries text and files together; there is no separate upload step

`POST /threads/:id/messages` accepts `multipart/form-data` (fields: `body`, `projectId`,
`replyToMessageId`, and up to 4 `files`) in addition to its current `application/json` text-only
shape, following the same content-type branch `daemon.ts:178-188`'s `readAudio` already uses. The
client holds pasted/browsed files as in-memory `File` objects and only sends them when Send is
pressed, in the same request as the text.

*Alternative considered:* upload-first (`POST /attachments` returns an id, the composer references it
on send). Rejected — it needs a `message_id` that starts `NULL`, which needs a garbage-collection sweep
for abandoned uploads (composer closed before Send) and a place to hook one; the codebase's periodic
maintenance lives in ad hoc `setInterval`s scoped to one service each (`server/src/channels.ts:72`,
`server/src/webhooks.ts:87`, `core/src/runs/dispatcher.ts:141`, `core/src/supervisor/index.ts:670`),
none of which attachments naturally belong to. The single-request design has no orphan state at all:
an attachment row is only ever created in the same transaction as the message that owns it.
*Consequence:* the composer needs its own file-preview affordance (thumbnail chip before Send),
entirely a UI-side concern.

### 2. Server-side limits, chosen from the evidence rather than picked arbitrarily

- Images: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, **≤5MB each** — the exact
  `maxBase64Size` the CLI's own paste feature enforces (Context table). Sending anything the CLI's own
  vision path would not accept gives a false "it worked."
- Text: `text/plain`, `text/markdown`, **≤256KB each** — inlined verbatim into the `ac_inbox` tool
  result, so the cap bounds how much of the conductor's context one attachment can spend.
- **≤4 files per message.**
- Anything else → `unsupported_media_type`, rejected before storage.
- `Content-Length` is checked against a total-request cap before the body is parsed at all
  (`threads.ts`, mirroring nothing that exists yet — no current route needs this, but the header check
  is a single comparison before `req.formData()`), satisfying "before the human has waited for a long
  transfer" for the case that is checkable that way; a per-part size is re-checked as each part is read
  since `Content-Length` is the whole request, not one file.
- Media type is read from the client's declared `Content-Type` for the allowlist check; images are
  additionally sniffed by magic bytes (PNG/JPEG/GIF/WebP headers — the same four-byte-class of check
  the CLI's own code performs, `iT(e)` in the Context evidence) before being trusted, so a mislabelled
  file cannot pass as an image it is not.

### 3. Storage: workspace state dir, server-generated name, authenticated serving

`workspacePaths(root)` (`packages/core/src/context.ts:26-28`) already defines the non-served,
per-workspace data directory (`root/.agent-conductor/`, holding `runs/`, `runtimes/`, `db.sqlite`).
Attachments join it: `root/.agent-conductor/attachments/<attachmentId>.<ext>`, where `<attachmentId>`
is a server-generated ULID and `<ext>` comes from a fixed media-type→extension map — **never** from
the client's filename or declared type string. The client's filename is stored only as a display
column (sanitized: control characters stripped, length-capped) and is never used to build a path.

Serving is `GET /threads/:threadId/attachments/:attachmentId`, mounted under the existing `/api`
router (`authMiddleware`, `app.ts:41` — session cookie, run token, or bearer, exactly like every other
route) and additionally checked against `attachment.threadId === :threadId` from the URL, returning
`not_found` on any mismatch. Workspace scoping needs no extra column or check: `packages/core/src/
context.ts` confirms each workspace owns its own SQLite file (`db: j('.agent-conductor',
'db.sqlite')`), so an attachment id from workspace B simply does not exist in workspace A's database —
cross-workspace reachability is structurally impossible, the same guarantee every other table in this
schema already relies on.

Because the web app authenticates browser requests with the `ac_session` cookie
(`packages/server/src/auth.ts:86-89`), an `<img src="/api/threads/.../attachments/...">` in the
transcript works with no token plumbing on the client side — the browser attaches the cookie the same
way it would for any same-origin `<img>`.

*Alternative considered:* a signed short-lived URL for the `<img src>`. Rejected — unnecessary; the
existing cookie auth already covers this exactly like it covers every other authenticated GET the web
app renders.

### 4. `ToolResult` gains an optional `mcpContent`, consumed once at the MCP boundary

`packages/shared/src/errors.ts`'s `ToolResult<T>` success branch gains an optional field:
`mcpContent?: Array<{ type: 'image'; data: string; mimeType: string }>`. A handler that has image
bytes to deliver (only `ac_inbox`, initially) sets it; every other handler is unaffected —
`ok(data)` still returns exactly what it does today.

`packages/server/src/mcp.ts:25-31`'s `CallToolRequestSchema` handler is the one place a `ToolResult`
becomes an MCP `CallToolResult`; it appends `result.ok && result.mcpContent ? result.mcpContent : []`
after the existing single `text` block, so `content` becomes `[textBlock, ...imageBlocks]` — the model
receives the JSON summary and the images together, in the same tool result.

*Alternative considered:* a new tool (e.g. `ac_attachment_get`) the conductor calls per attachment.
Rejected — it adds a round trip the conductor has to remember to make, is not how VS-99's own
"never widen silently" precedent for `ac_inbox` behaves (the tool already bundles everything relevant
to why the agent woke), and there is no guarantee the model calls a tool it was not told to.

### 5. `ac_inbox`'s `human_message` entries resolve attachments inline

`packages/server/src/tools.ts:176-199`: for each `human_message` wake entry, when
`entry.payload.attachmentIds` is non-empty, the handler reads each attachment's stored bytes. Images
are pushed onto the handler's accumulated `mcpContent` (base64 + the stored `mediaType`); text
documents are decoded and appended directly into `entry.attachments[i].text` (no truncation below the
256KB cap already enforced at write time — the whole point of that cap is that inlining it whole is
safe). Attachments referenced by decisions or ticket wakes are out of scope (Non-Goals) and this
handler never looks for them there.

### 6. `parts` gets one new, additive shape: the `attachment` part

`ThreadMessage.parts` (`packages/shared/src/types.ts:90`) is presently unread by any renderer
(`packages/render`, `packages/ui`) — every message today is `parts: []`. This change adds one part
shape, `{ type: 'attachment', id, filename, mediaType, byteSize }`, written by `threads.inbound` in the
same transaction as the message and the `attachments` rows, and read back exactly as every other
message field is (`GET /:id/messages`, the live `thread.message` SSE event). `packages/render` gets a
pure function turning that part into a view-model annotation (its own established convention: "pure
view-model functions shared by web and TUI"); `packages/ui`'s message bubble renders a thumbnail for an
image part (`<img src="/api/threads/:id/attachments/:attachmentId">`) and a filename chip with a
download link for a text part.

### 7. Retention: an attachment lives exactly as long as the message that owns it

No TTL, no separate deletion path, no counting toward usage. Attachments are stored once, at send
time, in the same transaction as the message; there is no message-deletion capability anywhere in this
codebase today (confirmed: no delete route on `threads.ts`, no `delivery_status` value meaning
"deleted"), so "does deleting a message delete the file" has no current answer to give beyond a
constraint on the future: if message deletion is ever added, it must delete the attachment's row and
file in the same transaction, exactly as this change deletes nothing today because nothing deletes
messages today. This is stated in the spec as a requirement on any future deletion path, not built as
a feature nothing calls.

### 8. Attachments are refused on a ticket-bound thread

`threads.inbound` (`service.ts:156-158`) already branches on `t.ticketId`: bound → the message becomes
a ticket comment via `tickets.comment`, with no wake payload at all. Since delivery depends entirely on
the wake payload `ac_inbox` reads, and the ticket says worker/ticket attachments are out of scope, the
route rejects a multipart request (`validation`, "attachments are not supported on a ticket-bound
thread") before the transaction opens, rather than silently storing a file the conductor can never be
shown.

## Risks / Trade-offs

- **The CLI's paste-image and MCP-image-content-block behaviors are read from strings, not observed
  live**, per the runtime-credential rule. → The same posture ADR 0012 took: fake-CLI and fake-MCP-client
  tests pin our side of the contract; the first real attachment after deploy is the confirmation, and
  the PR must say so plainly, not claim it as verified.
- **A 5MB image, base64-encoded, is ~6.7MB of JSON in one MCP tool result.** → Bounded by the 4-file cap
  (worst case ~27MB for one `ac_inbox` call); no smaller today than a large `ac_ticket_get` payload
  already can be, and the CLI's own cap is the same order of magnitude, so nothing here asks the CLI to
  handle something its own feature does not already handle.
- **A mislabelled file's declared `Content-Type` could claim `image/png` while being something else.**
  → Magic-byte sniffing on the four accepted image types before trusting the label (Decision 2); text
  types have no meaningful magic bytes to sniff, so they rely on the extension/type allowlist plus the
  256KB cap that keeps a mislabelled file's blast radius small.
- **Filename collisions or path traversal via a crafted filename.** → The stored filename is never used
  to build a path; the on-disk name is always `<server-generated ULID>.<extension-from-allowlist>`
  (Decision 3).

## Migration Plan

New table (`attachments`), additive `ToolResult.mcpContent` field, additive `parts` shape — nothing
existing changes shape. No backfill: attachments start existing only for messages sent after this
change ships. Rollback is deleting the migration's table and reverting the route/tool changes; no data
written by this change is referenced by anything outside it.

## Open Questions

None the ticket needs settled before implementation — the one genuine unknown (whether the runtime can
receive an image at all) is answered in Context, from evidence, with the honest fallback (refuse
non-image/non-text types) already built into the design rather than left open.
