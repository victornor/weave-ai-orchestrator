## 1. Chat styles titled https links as buttons

- [x] 1.1 On chat `MessageBody` in `packages/ui/src/routes/Chat.tsx`, pass a chat-scoped class (e.g. `ac-chat-prose`) into `<Markdown>` alongside `text-body`. Verify the class is on the rendered `.ac-prose` of a thread message and not on a ticket-comment `<Markdown>` in `TicketPage`.
- [x] 1.2 In `packages/ui/src/index.css`, style `.ac-chat-prose a[href^="https://"]` as a compact wrap-friendly pill: label visible, no underline, `inline-flex`, gap/wrap, `max-width: 100%`, long labels wrap inside the pill, padding larger than the ticket-identifier chip, tokens only (no raw hex in a component). Verify ticket chips (`#ticket:`) and doc-links are unaffected by inspecting the existing chip/doc-link rules still matching first.
- [x] 1.3 In `packages/ui/src/test/chat.test.tsx`, add a case: a conductor message whose body is `Opened it.\n\n[GitHub pull request 130](https://github.com/acme/repo/pull/130)` renders a link named "GitHub pull request 130" with `href="https://github.com/acme/repo/pull/130"`, `target="_blank"`, and the chat-scoped class (so the pill CSS applies). The URL string MUST NOT appear as paragraph text.
- [x] 1.4 In the same file, add a case: one conductor message with two `https:` markdown links renders two such links. Also assert a markdown link whose target is `javascript:alert(1)` is not an `https:` button (no `javascript:` href).

## 2. Conductor authors them as markdown

- [x] 2.1 Extend `ac_human_send`'s `description` in `packages/server/src/tools.ts` to say titled links go in `body` as `[label](https://url)` and render as compact buttons in chat. Verify the string is in the tool description (existing mcp/tools tests that snapshot names still pass).
- [x] 2.2 Add one line to `templates/conductor.AGENTS.md.tmpl` under "How you talk": when pointing at an external URL, write `[short label](https://url)` in `ac_human_send` rather than pasting the bare URL. Verify `packages/core/src/prompts/render.test.ts` still matches the template (update the assertion if it snapshots that section).

## 3. Spec and delivery

- [x] 3.1 Confirm `openspec validate vs-163-let-conductor-replies-include-titled-lin --json --strict` passes.
- [x] 3.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 3.3 Open the PR, record it on the ticket, and state that Telegram/TUI/ticket comments were left unstyled on purpose.
