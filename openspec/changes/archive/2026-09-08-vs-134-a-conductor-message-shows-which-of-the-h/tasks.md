## 1. `threads.outbound()` validates and stores a reply reference

- [x] 1.1 Add `replyToMessageId?: string | null` to `ThreadsService.outbound()`'s opts type in `packages/core/src/api.ts`.
- [x] 1.2 In `packages/core/src/threads/service.ts`, make `outbound()` resolve `opts.replyToMessageId` through the existing `repliedToMessage(threadId, id)` helper before the insert (mirroring `inbound()`), passing the derived `replyToMessageId`/`replyToExcerpt` into `insertMessage()`. An unknown or cross-thread id throws `OcError('not_found', ...)`, the same as `inbound()`.
- [x] 1.3 Add tests to `packages/core/src/threads/threads.test.ts`: an outbound message with a valid same-thread target stores the reference and a bounded excerpt (verify via `threads.messages()`); an outbound target that does not exist is rejected and no message is stored; an outbound target belonging to another thread is rejected the same way. Verify: `pnpm vitest run packages/core/src/threads/threads.test.ts`.

## 2. `ac_human_send` accepts and defaults a reply target

- [x] 2.1 In `packages/server/src/tools.ts`, add `replyToMessageId: z.string().nullable().optional()` to `ac_human_send`'s input schema.
- [x] 2.2 Add a `defaultReplyToMessageId(ctx)` helper next to `originThreadId(ctx)`: filter `bundledWakes(ctx)` to `source === 'human_message'`; if exactly one, return its `payload.messageId` (typed as a string, else `null`); otherwise return `null`.
- [x] 2.3 In the handler, resolve `replyToMessageId = i.replyToMessageId === undefined ? defaultReplyToMessageId(ctx) : i.replyToMessageId` and pass it to `threads.outbound(ctx.actor, threadId, i.body, { runId: ctx.claims.runId, replyToMessageId })`.
- [x] 2.4 Update `ac_human_send`'s tool `description` to state: it accepts an optional reply target, defaults to the single message that woke the turn when there is exactly one, and `replyToMessageId: null` sends with no target regardless of the default — the way to send something unrelated (e.g. a ticket landing) in the same turn as answering that message.

## 3. End-to-end coverage through the real wake → tool → thread path

- [x] 3.1 In `packages/server/test/integration.test.ts`, add a case: a real conductor `human_message` wake is raised via `services.threads.inbound(...)` on a thread not bound to a ticket, a `runs` row is inserted binding that wake's id to a signed run token (following the existing `wakeupIdsJson` pattern from `packages/core/src/runs/dispatcher.ts` / `engine.test.ts`), then `POST /agent/tools/ac_human_send` with no `replyToMessageId` is called for that run — assert the resulting message (via `services.threads.messages(threadId)`) carries a reference to the message that woke the turn, with its excerpt.
- [x] 3.2 Add a case to the same test: the same setup, but the call passes `replyToMessageId: null` — assert the resulting message carries no reference.
- [x] 3.3 Add a case to the same test: two `human_message` wakes bound to the run (two inbound messages before the call) — assert a call with no `replyToMessageId` stores no reference (no default when ambiguous). (Two inbound messages before dispatch coalesce into one wake row with the second folded into `payload.bundle`; the default helper flattens via `flattenWakes` so this still counts as two human messages and applies no default.)
- [x] 3.4 Verify: `pnpm vitest run packages/server/test/integration.test.ts`.

## 4. Verification

- [x] 4.1 `pnpm typecheck` green (chained `tsc -b` + ui filter, per project convention).
- [x] 4.2 `pnpm lint` green.
- [x] 4.3 `pnpm test` green (root vitest run, plus the ui suite it chains). 125/126 + 1 skipped root files, 57/57 ui files, all passing.
- [x] 4.4 `openspec validate vs-134-a-conductor-message-shows-which-of-the-h --json --strict` clean.
