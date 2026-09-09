## Why

Captain (2026-09-09) wants a conductor reply to carry a short label such as
"GitHub pull request 130" as a compact button that opens the real URL, not
another long URL in the paragraph. `ac_human_send` is already a markdown body,
and `[label](https://…)` already becomes an underlined `<a>` in chat; the gap
is the button, not a new store.

## What Changes

- In the conductor chat, a markdown link whose target is an `https:` URL
  renders as a compact button: the chosen label is visible, the URL is behind
  the tap, and several such buttons in one reply wrap at phone width.
- The conductor authors them as ordinary markdown in `ac_human_send`'s `body`
  (`[GitHub pull request 130](https://github.com/…)`). No new tool field, no
  new column. The tool description and the conductor's always-loaded prompt
  say so, so the conductor actually writes them instead of pasting a bare URL.
- `javascript:`, `data:` and other non-`https:` schemes stay as they are today
  (already stripped or left as text). Ticket-identifier chips (`#ticket:`) and
  knowledge doc-links (`#doc:`) are unchanged.
- Ticket comments, Telegram and the TUI are not restyled. Telegram/TUI keep
  whatever they already do with the same markdown body.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/message-formatting`: adds a requirement that an `https:`
  markdown link in a conductor-chat message is shown as a compact titled
  button (label visible, URL on tap), that several can appear in one reply and
  wrap at phone width, and that non-`https:` targets do not become buttons.

## Impact

- `packages/ui/src/routes/Chat.tsx` — chat `MessageBody` marks its markdown so
  https links can be styled as buttons without touching other `<Markdown>`
  consumers.
- `packages/ui/src/index.css` — compact button styles, scoped to chat, using
  existing tokens (no raw hex/px in components).
- `packages/server/src/tools.ts` — `ac_human_send` description names the
  `[label](https://url)` authoring form.
- `templates/conductor.AGENTS.md.tmpl` (and the matching line in the conductor
  skill if it talks about sending) — one line so the conductor uses titled
  links instead of bare URLs.
- Tests: `packages/ui/src/test/chat.test.tsx` covers a titled link button in a
  conductor reply (label, https href, `target="_blank"`, more than one in one
  message). Existing markdown unit tests stay green.
- No daemon schema, no API shape, no Telegram/TUI restyle.
