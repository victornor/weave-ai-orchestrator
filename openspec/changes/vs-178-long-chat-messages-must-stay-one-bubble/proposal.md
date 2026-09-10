## Why

A long conductor reply with a fenced data-model currently reads as several
messages, with the code sitting in the thread chrome rather than inside a
bubble. Outbound `ChatMessage` rows have no containing box (`w-full`, no
background), while a fenced block has its own card chrome — so one stored
`ac_human_send` looks like three. Captain hit this 2026-09-10.

## What Changes

- Every conductor-chat thread message — inbound and outbound — is one visual
  bubble. Markdown, fenced code and GFM tables stay inside that bubble;
  nothing paints into the thread chrome.
- A wide fence or table scrolls inside the bubble (`min-w-0` / overflow
  containment). An unclosed fence is closed by the renderer (already) so it
  cannot swallow later chrome.
- GFM pipe tables in a chat body render as a table inside the bubble, not as
  raw pipes that look like a separate card.
- One `ac_human_send` stays one stored `thread_message`. The daemon does not
  split bodies; there is no size limit on `body` today, and this change does
  not add one. If a future limit ever forced a split, it would break on a
  paragraph, close open fences, and never leave a half-rendered block
  escaping the container — but that path is not built here.
- The conductor is told (tool description / always-loaded prompt) to send one
  logical reply as one `ac_human_send`, not several.
- Telegram and TUI are unchanged. Stored bodies are unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/message-formatting`: a thread message is one bounded bubble
  with all of its formatted content inside it; GFM tables in a chat body
  render as a table inside that bubble; a long fence does not leak.

## Impact

- `packages/ui/src/routes/Chat.tsx` — `ChatMessage` wrapping: both directions
  get a containing bubble; conductor currently has none.
- `packages/ui/src/index.css` — bubble overflow containment so `pre` / table
  cannot expand the flex column.
- `packages/ui/src/lib/markdown.ts` — GFM pipe tables; unclosed fences already
  flush (keep that).
- `packages/server/src/tools.ts` and `templates/conductor.AGENTS.md.tmpl` —
  one-reply-one-send line.
- Tests: `packages/ui/src/test/chat.test.tsx` (one bubble, long fence inside
  it) and markdown unit tests for a table + unclosed fence.
- No schema, no API shape, no Telegram/TUI restyle.
