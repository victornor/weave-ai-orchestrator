# Tasks — VS-449

## 1. The link table

- [x] 1.1 Add `packages/db/src/migrations/0042_thread_message_replies.sql`: a `thread_message_replies(message_id, replied_to_message_id)` table with both columns referencing `thread_messages(id)`, a target index, and an `INSERT ... SELECT` backfill from every non-null `thread_messages.reply_to_message_id`. Verify: `packages/db/src/migrations.test.ts` covers the table, the backfill and the pair-uniqueness.

## 2. The default target for a batched turn

- [x] 2.1 Extend `ThreadsService.outbound` (`packages/core/src/api.ts`, `packages/core/src/threads/service.ts`) with `defaultReplyToMessageIds`: when `replyToMessageId` is omitted, link the reply to every candidate that exists in the thread and that no earlier reply of the same `runId` has already linked, oldest-first; `reply_to_message_id` is the newest. An explicit id (or `null`) is honoured exactly.
- [x] 2.2 Write a `thread_message_replies` row for every reply in `insertMessage`, and return `replyToMessageIds` on the write result.
- [x] 2.3 In `packages/server/src/tools.ts`, replace `defaultReplyToMessageId` with `defaultReplyToMessageIds` (every human message in the flattened wake, deduped) and update the `weave_human_send` handler + description. Verify: `packages/core/src/threads/threads.test.ts` and `packages/server/test/integration.test.ts` cover single, batched, explicit-null and explicit-id, plus the second-send-in-one-turn rule.

## 3. Expose the links

- [x] 3.1 Add `replyToMessageIds: string[]` to `ThreadMessage` (`packages/shared/src/types.ts`) and populate it on `messages()`, `around()` and `message()` in `packages/core/src/threads/service.ts`. Verify: an API-shape test asserts the field on a read.
- [x] 3.2 Update `docs/API.md`'s thread-messages bullet to document `replyToMessageIds` and the batched default.

## 4. V2 quote for multiple targets

- [x] 4.1 In `packages/ui/src/v2/ChatMessage.tsx`, when a reply answers more than one message, show the newest excerpt followed by `+N more`. Verify: `packages/ui/src/test/v2chat.test.tsx` asserts the marker.

## 5. Suites and lint

- [x] 5.1 `pnpm lint && pnpm typecheck` clean.
- [x] 5.2 `pnpm test` green — paste both the core/server and UI suite blocks verbatim in the report.