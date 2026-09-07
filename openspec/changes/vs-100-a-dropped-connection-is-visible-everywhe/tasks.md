## 1. Shared live-stream connection primitive

- [x] 1.1 Add `packages/ui/src/api/sseStream.ts`: move `ConnectionState`/`ConnectionStatus` and the `BACKOFF` table here from `api/events.ts` (re-exported from there for existing importers), and implement `useLiveStream({ url, eventTypes, onFrame, resetKey })` covering open/close, named-event dispatch, bounded indefinite backoff, `navigator.onLine`/`online`/`offline` handling and `retryNow()`. Verify with a new `sseStream.test.tsx` driving it through connecting → connected → error → reconnecting/offline → the `online` fast path → manual retry, using a `FakeEventSource` in the style of `runStream.test.tsx`.
- [x] 1.2 Update `api/events.ts`'s `EventStream` class to import `ConnectionState`/`ConnectionStatus`/`BACKOFF` from `api/sseStream.ts` instead of declaring its own copies. Verify `pnpm typecheck` and the existing `events.test.tsx` still pass unchanged.

## 2. Run event stream

- [x] 2.1 Rewrite `useRunEventStream` in `api/runStream.ts` on top of `useLiveStream`, returning `{ events, status, retryNow }`. Preserve the persisted+tail merge, de-dup-by-id and seq-ordering behavior exactly. Verify by updating `runStream.test.tsx`'s call sites to read `result.current.events` — all existing assertions keep passing unchanged otherwise.
- [x] 2.2 Add tests to `runStream.test.tsx` (or a new file) for the added surface: `status.state` transitions through `connecting` → `connected`, drops to `reconnecting` on error, to `offline` when `navigator.onLine` is false or the browser fires `offline`, reconnects at once on `online`, and `retryNow()` re-opens immediately and resets the backoff counter. Verify all new cases pass.
- [x] 2.3 Update `RunPage.tsx` and `TicketPage.tsx` for the new return shape (`const { events } = useRunEventStream(...)`), no behavior change. Verify `pnpm typecheck` and their existing tests (if any) still pass.

## 3. Job stream

- [x] 3.1 Rewrite `useJobStream` in `api/jobStream.ts` on top of `useLiveStream`, returning `{ job, status, retryNow }`, preserving the `reduce()` folding logic and the 200-line log cap unchanged.
- [x] 3.2 Add a `jobStream.test.tsx` covering the same connection-state transitions as 2.2, adapted to jobs (there is no existing test file for this hook today).
- [x] 3.3 Update `Onboarding.tsx` for the new return shape and render a `StreamStatusNotice` (task 4.1) next to the job's step/log view when `status.state !== 'connected'`. Verify manually against a job forced to error via the fake CLI harness, or note in the PR if unverified.

## 4. Chat surfaces the run stream's connection state

- [x] 4.1 Add `packages/ui/src/components/StreamStatus.tsx` exporting `StreamStatusNotice({ status, onRetry })`: renders nothing when connected, otherwise a compact inline notice (reusing `ConnectionBanner`'s `working`/`blocked` color tokens) with state text and a "Retry now" button calling `onRetry`.
- [x] 4.2 Render `StreamStatusNotice` inside `Chat.tsx`'s `working || live` block, wired to the run stream's `status`/`retryNow` from task 2.1. Verify with a `chat.test.tsx` case: drive the run stream's `FakeEventSource` through `onerror`, assert the notice appears with the right text, then resolve the connection and assert it disappears without any duplicated transcript rows.
- [x] 4.3 Verify the phone layout: render the notice with the phone viewport fixtures already used elsewhere in `chat.test.tsx` (or a targeted snapshot) and assert it does not overlap the composer or `BottomBar` — e.g. that it renders inside the scrolling `PageBody`, not as a fixed-position element.

## 5. Chat no longer silently drops a send or a decision answer

- [x] 5.1 In `Chat.tsx`'s `send()`, add an `onError` to `post.mutate` that enqueues the message (same shape as the existing offline branch) when the error is a `NetworkError`, and calls `setSending(false)` on both the error and success paths so the working indicator never sticks. Verify with a `chat.test.tsx` case: make the mocked `usePostThreadMessage` mutate reject with a `NetworkError`-shaped error, send a message, assert it lands in the queue (`enqueue` called) and the working indicator clears.
- [x] 5.2 Extract the secret-input check from `NeedsYou.tsx` (`inputs.some((i) => i.type === 'secret')`) into a shared helper, e.g. `lib/decisionSecrets.ts`, and use it from both `NeedsYou.tsx` and the new `Chat.tsx` logic in 5.3. Verify `needsyou.test.tsx` still passes unchanged.
- [x] 5.3 In `Chat.tsx`'s `answerDecision()`, mirror `NeedsYou.tsx`'s offline handling: when `conn.state` is `offline`/`unreachable` or the card carries a secret and the mutate fails, refuse with a toast (secret) or enqueue (non-secret, using `kind: 'decision'`); otherwise mutate directly with an `onError` that enqueues on a `NetworkError` for a non-secret card. Verify with `chat.test.tsx` cases mirroring `needsyou.test.tsx`'s offline-decision coverage: a non-secret answer queues while offline or on a network failure, a secret-carrying answer never queues and tells the human it was not sent.

## 6. Full verification

- [x] 6.1 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (root, which chains the ui suite) and confirm all green, including the existing `ConnectionBanner`/`events.test.tsx`/`runStream.test.tsx` coverage unchanged in behavior.
- [x] 6.2 Re-read the ticket's acceptance criteria 1-7 against the merged diff and note in the PR description which are verified by test and which (the real flaky-mobile-connection check, called out in the ticket's own Verification section) remain for captain to confirm manually.
