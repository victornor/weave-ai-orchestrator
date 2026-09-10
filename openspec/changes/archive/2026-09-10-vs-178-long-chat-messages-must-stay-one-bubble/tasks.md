## 1. Bubble both directions and contain overflow

- [x] 1.1 In `packages/ui/src/routes/Chat.tsx` `ChatMessage`, wrap outbound (conductor) messages in a containing bubble (background, radius, padding, `min-w-0`, `max-w-full`) so both directions have a message container. Keep inbound as the existing right-aligned bubble. Verify a chat test can query one container per thread message for both directions.
- [x] 1.2 In `packages/ui/src/index.css`, contain wide fences and tables inside the bubble: `min-w-0` on the message box if not already a utility class, `overflow-x: auto` on `.ac-prose pre` (already) and on tables / a table wrapper, without clipping the fence copy button on Y. Verify the rules exist by reading the stylesheet (jsdom has no layout).
- [x] 1.3 In `packages/ui/src/test/chat.test.tsx`, add a case: one outbound message whose body is long markdown with a fenced data-model (several lines, at least one longer than a typical column) renders as exactly one message container, and the `<pre>` is a descendant of that container. Also assert a following second message is a separate container (unclosed-fence body on the first must not swallow it).

## 2. GFM tables in the markdown renderer

- [x] 2.1 In `packages/ui/src/lib/markdown.ts`, parse a GFM pipe table (header row, separator, body rows) into `<table><thead>…</thead><tbody>…</tbody></table>`, escaping cells then applying inline markup. Verify with a unit test in `packages/ui/src/test/transcript.test.tsx` (or the existing markdown tests there) that a small pipe table emits a `<table>` with the header and cell text, and that markdown inside a cell is inline-formatted.
- [x] 2.2 In `packages/ui/src/test/chat.test.tsx`, add a case: one conductor message whose body is a GFM pipe table renders a `<table>` inside that message's container, not as raw `|` text outside it.

## 3. Conductor sends one reply as one call

- [x] 3.1 Extend `ac_human_send`'s description in `packages/server/src/tools.ts` to say a single logical reply goes in one call, including long markdown with fences or tables; do not split across several sends. Verify the string is in the tool description.
- [x] 3.2 Add one line to `templates/conductor.AGENTS.md.tmpl` under how the conductor talks: one reply is one `ac_human_send`. Verify `packages/core/src/prompts/render.test.ts` still matches the template (update the assertion if it snapshots that section).

## 4. Spec and delivery

- [x] 4.1 Confirm `openspec validate vs-178-long-chat-messages-must-stay-one-bubble --json --strict` passes.
- [x] 4.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 4.3 Open the PR, record it on the ticket, and state that Telegram/TUI were left unchanged and that the daemon does not split message bodies.
