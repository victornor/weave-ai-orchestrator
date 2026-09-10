# Tasks

## 1. Bind the chat thread to the active workspace

- [x] 1.1 Key an inner chat page on `ws` so `threadId`, `live`, `sending` and in-memory attachments reset on a workspace switch, and only pass a thread id to `useThreadMessages` when it is in this workspace's `useThreads()` result (or just created here). Verify a chat-to-chat switch no longer enables the messages query with the previous workspace's id.
- [x] 1.2 After `ws` changes, select `threads.data[0]` or create a web thread for the new workspace (same empty-list path as today). Verify the chat shows that workspace's history or the empty composer, not the load-error card.

## 2. Recover a foreign-thread 404

- [x] 2.1 When messages fail with `not_found` and the requested id is not in this workspace's thread list, drop it and re-run selection; leave today's error card for a 404 on a thread this workspace does own. Verify a foreign 404 recovers without a document reload.

## 3. Tests and gates

- [x] 3.1 In `packages/ui/src/test/chat.test.tsx`, cover A→B chat switch (messages not requested with A's id once `ws` is B; no error card; B's thread shown) and a foreign `not_found` recovering to B's thread. Existing chat tests still pass.
- [x] 3.2 `pnpm lint`, `pnpm typecheck`, and `pnpm test` are green.
