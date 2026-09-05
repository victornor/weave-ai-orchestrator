## 1. Storage and DTO

- [x] 1.1 Add migration `packages/db/src/migrations/0006_thread_message_reply.sql` adding a nullable `reply_to_message_id TEXT REFERENCES thread_messages(id)` to `thread_messages` (no backfill, no index, no `ON DELETE`), and add `replyToMessageId: string | null` and `replyToExcerpt: string | null` to `ThreadMessage` in `packages/shared/src/types.ts`; verify by running `pnpm vitest run packages/core packages/db` and confirming the suite still migrates a fresh database green.

## 2. Carrying the reference through the service

- [x] 2.1 Extend `ThreadsService.inbound`'s options in `packages/core/src/api.ts` with `replyToMessageId?: string | null` and thread it through `insertMessage` in `packages/core/src/threads/service.ts` so the column is written; verify with a core threads test that sends an inbound message replying to an earlier message of the same thread and asserts `threads.messages(...)` returns it with that `replyToMessageId`, plus one asserting a message sent without it has `replyToMessageId: null` and `replyToExcerpt: null`.
- [x] 2.2 Resolve the reference inside `inbound`'s transaction **before** the insert with a lookup scoped to the message's own thread (`WHERE id = ? AND thread_id = ?`), throwing `not_found` when there is no row; verify with core threads tests asserting that an unknown message id rejects and that a message id belonging to a different thread rejects the same way, each storing no message on the thread and enqueueing no wake.
- [x] 2.3 Return the referenced message's body as a bounded `replyToExcerpt` from `ThreadsService.messages` via `LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id`, bounded by one exported `REPLY_EXCERPT_CHARS = 500` constant; verify with core threads tests asserting the excerpt is present on a replying message, that it is truncated to the bound for a longer referenced body, and that it is still returned when the read's `limit`/`before` window excludes the referenced message.
- [x] 2.4 Add `replyToMessageId` and `replyToExcerpt` (both `null` when there was no reply, and the excerpt bounded by the same constant) to the `human_message` wake payload, leaving the wake's `reason` string unchanged; verify with core threads tests asserting the payload fields for a reply and for a message without one, and that the ticket-bound branch still comments and stores the reference without raising a `human_message` wake.

## 3. HTTP surface

- [x] 3.1 Accept an optional `replyToMessageId` on `POST /api/w/:ws/threads/:id/messages` in `packages/server/src/routes/threads.ts` and pass it to `inbound`; verify with server tests posting a message replying to an existing message of the thread (201, the reference and excerpt on the stored message) and one with an unknown message id (error status, nothing stored).
- [x] 3.2 Update the `POST /threads/:id/messages` line in `docs/API.md` to document the new optional field and the `replyToExcerpt` returned on reads.

## 4. Web conductor chat

- [x] 4.1 Add `replyToMessageId` to `usePostThreadMessage`'s input in `packages/ui/src/api/hooks.ts` so the field reaches the request body, and add the two new fields to the thread-message factory (which lives in `packages/ui/src/test/chat.test.tsx`, not `factories.ts`); verify with `pnpm typecheck` and by asserting the posted body in a UI test.
- [x] 4.2 Add a reply control to each conductor (outbound) message in `ChatRoute` and hold the chosen message id in one piece of state; verify with UI tests covering that the control appears on conductor messages, that it does not appear on the human's own messages, and that using it on a second message replaces the first rather than accumulating.
- [x] 4.3 Render the chosen message as a compact, dismissable quote through `Composer`'s existing `scope` slot alongside VS-14's project picker; verify with UI tests covering that the quote appears with the chosen message's text, that dismissing it removes the quote, and that the project picker still renders and still sends its value with the quote shown.
- [x] 4.4 Send the chosen reference with the message on both paths — `post.mutate` when online and the `enqueue` body when offline — and clear the quote after a send; verify with UI tests asserting the posted body and the queued body each carry `replyToMessageId`, that a send with no quote carries no reference, and that no quote is shown after sending.
- [x] 4.5 Render `replyToExcerpt` as a quote above the body of a sent human message in `ChatMessage`; verify with UI tests covering a message that carried a reply (quote shown, from the excerpt rather than from another message in the list), a message that carried none (no quote, unchanged rendering), and a replying message whose referenced message is not among the loaded messages (quote still shown).

## 5. Documentation of the deviation

- [x] 5.1 Write `docs/adr/0007-thread-message-reply-reference.md` recording the second `thread_messages` schema extension beyond PLAN §6's column list, with the reason and the alternatives from `design.md` — including why the excerpt is derived at read time rather than stored; verify the file exists and follows the heading format of `docs/adr/0005-thread-message-project-reference.md`.
- [x] 5.2 Add the reply quote to the `Composer` line in `docs/design/DESIGN-CONTRACT.md` so the visual contract matches what ships.

## 6. Verification

- [x] 6.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`, plus `pnpm --filter @agent-conductor/ui typecheck` (the web app is not in the root `tsconfig.json` project references), and confirm they pass, noting any pre-existing failures that also fail on `main` in a worker worktree.
  - `pnpm lint` ok, `pnpm typecheck` ok, `pnpm test` 703 passed / 1 skipped plus the web app's 141. `pnpm --filter @agent-conductor/ui typecheck` reports two errors that are **pre-existing on `main`** and untouched by this change, both from VS-20: `src/test/factories.ts:4` (`Ticket.mergeQueuedAt` is required in `shared` but the UI ticket factory never sets it) and `src/test/board.test.tsx:17` (`isFolded` gained an `opts` parameter, so it no longer type-checks as a bare `.filter` predicate). Verified against a clean `main` checkout; this branch adds no third error.
