## 1. Database

- [x] 1.1 Add migration `0020_thread_message_idempotency_key.sql`: nullable `idempotency_key` column on
      `thread_messages`, plus a unique index on `(thread_id, idempotency_key)` scoped to non-null keys.
      Verify: `pnpm --filter @agent-conductor/db test` passes and a fresh workspace database applies
      the migration cleanly.

## 2. Server: accept and dedupe the idempotency key

- [x] 2.1 `packages/server/src/routes/threads.ts`: add optional `idempotencyKey` to both the JSON body
      schema and the multipart form parsing in `sendWithAttachments`, threaded into the
      `threads.inbound(...)` call's options.
- [x] 2.2 `packages/core/src/threads/service.ts`: inside `inbound()`'s transaction, before
      `insertMessage`, look up an existing message on this thread by `idempotency_key` when one is
      given; if found, return it unchanged (no insert, no `ctx.events.emit`, no wake). Otherwise store
      the key on the new row.
- [x] 2.3 Unit tests in `packages/core/src/threads/threads.test.ts`: a repeated `inbound()` call with
      the same thread id and idempotency key returns the same message id, creates exactly one
      `thread_messages` row, and calls `wake.enqueue` exactly once; a call with no key, or a different
      key, behaves as today (a genuinely new message and a new wake).
- [x] 2.4 Route-level test in `packages/server/test/` (wherever `threads-attachments.test.ts` lives)
      covering the JSON path: two requests with the same `idempotencyKey` produce one stored message,
      the second response referencing the same message id.

## 3. Composer: in-flight lock, status, clear-on-settle

- [x] 3.1 `packages/ui/src/components/Composer.tsx`: add a `submitting` state; `send()` guards on it
      (`if (!t || disabled || submitting) return;`), sets it before calling `onSubmit`, and clears it
      in every settle path (success and failure) for both the files and no-files branches.
- [x] 3.2 Disable the send control (and treat Enter as a no-op via the same guard) while `submitting`
      is true; re-enable once it settles. Verify with a test that simulates an `onSubmit` that does not
      resolve immediately (a manually-controlled promise) and asserts the button is disabled and a
      second `send()` call makes no second call to `onSubmit`.
- [x] 3.3 Unify the files/no-files branches so both clear `text`/`files`/`attachError` only in the
      success path and both leave them untouched on rejection — extending today's files-only
      "kept for retry" behavior to plain text.
- [x] 3.4 Add a visible in-flight status line (spinner + "Sending…" / "Uploading and sending…" when
      `files.length > 0` at the moment `send()` was called). Verify by rendering the composer with a
      controlled `onSubmit` promise and asserting the text appears while pending and disappears once
      settled.
- [x] 3.5 Generate a per-attempt idempotency key in `Composer` (`crypto.randomUUID()`), reused on the
      next `send()` call only if the text and attached file names are unchanged from the last *failed*
      attempt; pass it as a third argument to `onSubmit`. Verify with a test: a failed send followed by
      an unedited retry passes the same key twice; editing the text before retrying passes a new key.

## 4. Chat: return a real promise, keep scope-on-failure, send the key

- [x] 4.1 `packages/ui/src/routes/Chat.tsx`: change the plain-text branch of `send()` from
      `post.mutate` to `post.mutateAsync`, returning its promise; move the
      `patch({ replyToId: null, projectId: null })` call into the success path only.
- [x] 4.2 Thread the idempotency key `Composer` now passes through to
      `post.mutateAsync`/`post.mutate` (both branches) and from there into the request body/form field.
- [x] 4.3 `packages/ui/src/api/hooks.ts` `usePostThreadMessage`: accept and forward `idempotencyKey` on
      both the multipart and JSON request paths.
- [x] 4.4 Update `ComposerProps['onSubmit']` type to
      `(text: string, files?: File[], idempotencyKey?: string) => void | Promise<void>`; confirm the
      other six `Composer` call sites (`DecisionCard.tsx` x2, `WorkerPage.tsx`, `TicketPage.tsx` x4)
      still typecheck unchanged (they ignore the new third argument).

## 5. Verification

- [x] 5.1 `pnpm --filter @agent-conductor/ui exec vitest run` covers: double-tap during an in-flight
      send fires one request; a failed plain-text send keeps the composer's text, reply reference and
      project pick; a failed attachment send still keeps its attachment (regression check on the
      behavior moved out of `message-attachments`); a successful retry after a failure clears
      everything.
- [x] 5.2 `pnpm typecheck && pnpm lint && pnpm test` green at the repo root.
- [x] 5.3 Manual verification per the ticket: throttle the connection in a real browser (Chrome
      DevTools network throttling), attach a phone-camera-sized image (a few MB), double-tap send, and
      record — in the PR — that only one message and one ticket-worthy wake resulted, and describe what
      the composer showed during the wait, at phone width (375px or similar). Static screenshots of the
      "Sending…" state are acceptable; the sequence (idle → sending → confirmed, or idle → sending →
      failed → retry → confirmed) should be described in words since this cannot be a single static
      capture.
- [x] 5.4 State in the PR description, per the ticket's ask, what protection exists after this change
      and at which layer: client-side lock (prevents the common case), server-side idempotency key
      (closes the lost-response retry gap the lock alone cannot). Confirm no re-encoding/inflation of
      attachments was found (already investigated during propose; restate the finding).
