# ADR 0015 — Attachments reach the conductor through `ac_inbox`'s MCP content, not the turn prompt

**Status:** accepted · 2026-09-08 · adds surface area PLAN's headless-turn description does not
mention; deviates from no existing PLAN row

## Context

VS-133 ("files and images can be attached to a conductor chat message... and the conductor can
actually read them") needed to settle a genuine unknown first: whether the Claude runtime can be
shown an image at all, and by what mechanism. Launching the real CLI to find out is forbidden by the
runtime-credential rule (ADR 0012, VS-99) — the answer was established instead by reading the
installed `claude` binary's own strings (`strings -a`, piped to a scratch file, never executed), the
same method and the same binary (2.1.258) VS-99 used.

### What the strings show

| Fact | Evidence |
|---|---|
| The CLI's own interactive paste feature builds a real image content block | `{block:{type:"image",source:{type:"base64",media_type:fOe(d),data:d.toString("base64")}}}` and, at the UI layer, `{id:Ur,type:"image",content:zn,mediaType:Xn?.mediaType\|\|"image/png",filename:Xn?.filename\|\|"Pasted image", ...}` — the CLI's "Pasted image" clipboard feature, confirming paste-to-vision is a shipped path in this binary. |
| Its own image cap | `var UA={maxWidth:2000,maxHeight:2000,maxBase64Size:5242880}` — 5MB base64, 2000×2000. |
| An MCP tool result's `image` content becomes a real vision block | `return{tool_use_id:n,type:"tool_result",content:[{type:"image",source:{type:"base64",media_type:o,data:r.data}}]}` — an MCP tool result whose content included an image is turned into this exact `tool_result` block, matching the Anthropic Messages API's own image content shape. |
| PDFs get a distinct `document` block | `{type:"document",source:{type:"base64",media_type:"application/pdf",data:p.base64}}` — evidenced only for the CLI's own internal `Read` tool handling a local PDF path, never for anything arriving over MCP. |
| Everything else the CLI's own tools read becomes plain text | No string anywhere shows a non-image, non-PDF file becoming anything but a `{type:"text",...}` block. |

Separately (read directly, not from strings): `packages/server/src/mcp.ts` already runs
`@modelcontextprotocol/sdk@1.30.0`, whose `types.d.ts` declares `ImageContentSchema` (`type:"image"`,
`data`, `mimeType`) as a member of `CallToolResultSchema`'s `content` union — the daemon's own MCP
layer already speaks a protocol version that supports this, nothing to upgrade.

**Conclusion:** an image reaches the conductor as real vision input by returning an MCP `image`
content item from a tool call. A plain text document is inlined as text. A PDF, or any other binary
format, has no evidenced delivery path through anything this daemon controls, and VS-133 refuses one
server-side rather than storing it and pretending it was read.

### Why the prompt itself was never a candidate

Traced in full: `POST /threads/:id/messages` → `threads.inbound` → a `human_message` wake, `body`
truncated to 2000 characters in the payload → `buildTurnPrompt`/`flattenWakes`
(`packages/core/src/prompts/index.ts`) renders only a short "message from X" reason line into the
turn's prompt. The full body — and therefore any attachment reference — never reaches
`TurnInput.prompt`; the agent is expected to read it with `ac_inbox`, the tool its own brief tells it
to call first, every turn. There is no existing path where attaching content to the prompt would even
be seen, so this is not a stylistic choice between two working options — it is the only path that
already exists.

## Decision

`ToolResult<T>`'s success branch (`packages/shared/src/errors.ts`) gains an optional
`mcpContent?: McpImageBlock[]`. `packages/server/src/mcp.ts`'s `CallToolRequestSchema` handler appends
it, when present, after the existing single JSON `text` block — `content` becomes `[textBlock,
...imageBlocks]`. A handler sets it through a small escape hatch (`withMcpContent`/`isWithMcpContent`/
`mcpContentOf`) rather than reshaping its own return type, since `runTool` wraps every handler's
return in `ok(...)` uniformly and only `ac_inbox` needs to say more than its data.

`ac_inbox`'s handler resolves each `human_message` wake's attachment ids
(`packages/server/src/tools.ts`, `attachmentsForWake`): an image's bytes are read and pushed onto
`mcpContent` as `{type:'image', data: base64, mimeType}`; a text document's decoded content is
inlined directly into that message's `attachments` entry; a deleted or otherwise unreadable attachment
is dropped rather than failing the whole call. Nothing else — PDFs, other binaries — is delivered as
content; their upload is refused server-side before this point (`packages/server/src/routes/
threads.ts`), so `ac_inbox` never has one to resolve.

## Why

- **The transport had to be settled with evidence, not left as an open question**, per the ticket's
  own instruction — the same posture ADR 0012 took, for the same reason (the credential rule forbids
  the one way to check directly).
- **`ac_inbox` is the only place a human message's content is actually read.** Building a second path
  through the prompt would mean the conductor might see an attachment reference in `ac_inbox`'s JSON
  and the image itself nowhere, or duplicate work reshaping the prompt builder for a path nothing else
  uses.
- **A capability with no evidenced delivery path is refused, not half-built.** Storing a PDF and
  labelling it "attached" when nothing in this daemon can ever show its content to the model would be
  the exact failure mode the ticket warned against.

## Consequences

- Every `ac_inbox` call now resolves attachment bytes synchronously from disk for any bundled
  `human_message` wake that carries them — bounded by the 4-attachment-per-message cap and the 5MB
  image / 256KB text per-file caps (`packages/shared/src/attachments.ts`), so one call's worst case is
  a handful of megabytes of base64, the same order of magnitude the CLI's own paste feature already
  handles.
- `ToolResult.mcpContent` is additive and optional; every existing `ok(data)` call site — every tool
  but `ac_inbox` — is unaffected, pinned by `mcp.test.ts` asserting the no-mcpContent case still
  produces exactly one text block.
- **None of this is verified against a live CLI**, by rule. `mcp.test.ts` and `threads-attachments.
  test.ts` (VS-133) pin the daemon's own contract — a real MCP client receiving a genuine `image`
  content block from a genuine tool call, with a real HTTP send in front of it — but whether the
  Claude CLI actually renders that block as vision input remains the owner's to confirm on the first
  real attachment sent after deploy.
- If a future runtime other than Claude becomes the conductor's, this delivery mechanism needs its own
  investigation — nothing here assumes Codex, Gemini or OpenCode behave the same way, and none were
  checked.
