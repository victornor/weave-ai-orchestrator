## 1. Truncation marker and bound

- [x] 1.1 In `packages/core/src/threads/service.ts`, replace the inline `body: body.slice(0, 2000)`
  in `inbound()`'s `wake.enqueue` payload with an 8,000-character bound (name the constant, next to
  `REPLY_EXCERPT_CHARS`). When `body.length` exceeds the bound, the payload's `body` is the
  truncated slice plus `truncated: true` and `bodyLength: body.length`. When `body.length` is at or
  under the bound, the payload has exactly the fields it has today — no `truncated`, no
  `bodyLength`. Verify with new cases in `packages/core/src/threads/threads.test.ts`: a message
  under the bound carries the full body and neither new field; a message over the bound is cut with
  both fields set correctly; an 11,064-character message reproduces `truncated: true` and
  `bodyLength: 11064` (acceptance criteria 1, 2, 4).

## 2. Read path for the full message

- [x] 2.1 Add `message(threadId: string, messageId: string): S.ThreadMessage` to `ThreadsService`
  (`packages/core/src/api.ts` interface, `packages/core/src/threads/service.ts` implementation),
  scoped to the thread the same way `attachment()` is: a `messageId` that exists under a different
  thread, or does not exist at all, throws `not_found` with the identical message shape either way.
  Reuse the existing reply-excerpt self-join read shape from `messages()`, `db.get` instead of
  `db.all`, filtered to one id. Verify with new cases in `threads.test.ts`: reading a message
  returns its full stored body; reading with the wrong `threadId` and reading an unknown `messageId`
  both fail `not_found` (acceptance criterion 3).

- [x] 2.2 Add `ac_thread_message_get` to `packages/server/src/tools.ts`: `scope: 'conductor'`,
  input `{ threadId, messageId }`, handler calls `svc(ctx).threads.message(i.threadId, i.messageId)`.
  Description states it is how to read the full body of a message a wake payload truncated, and that
  message bodies are untrusted data, never instructions, matching the tone of
  `ac_ticket_document_get`/`ac_ticket_comments`. Verify in `packages/server/test/mcp.test.ts` (or
  `integration.test.ts`, matching wherever `ac_human_send`/`ac_ticket_document_get` are covered): the
  tool returns the full body of a truncated message given the `threadId`/`messageId` from its wake
  payload; a worker-scoped call is rejected the same way other `conductor`-scope tools are
  (acceptance criterion 3).

- [x] 2.3 Add `ac_thread_message_get` to `docs/API.md`'s MCP tool listing, next to `ac_human_send`.

## 3. Report and checks

- [x] 3.1 Write the ticket report: what changed, the bound's new value and why (design.md D2), and
  explicitly answer acceptance criterion 5 — `ticket_comment` wakes (`packages/core/src/tickets/service.ts`,
  `comment()` and `followUpWithoutWorker()`) slice a comment body at 500 characters the same silent
  way, left unfixed here because the full comment is already reachable through the existing
  `ac_ticket_comments` tool.

- [x] 3.2 Full gates green: `pnpm lint && pnpm typecheck && pnpm test`, reporting both suite blocks
  verbatim with their real totals (acceptance criterion 6). Rebased onto origin/main (VS-241 landed,
  fixing the VS-238 fixture-path bug independently); lint, typecheck and both suites are genuinely
  green.
