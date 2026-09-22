## 1. The conductor's failed turn is recorded in its conversation

- [x] 1.1 Add a conductor sibling to `deliverSessionAnswer` in `packages/core/src/runs/engine.ts` (e.g. `deliverConductorTurnNotice`), gated to `agent.kind === 'weaver'`, reusing `sessionOutcomeNotice`/`plainFailureReason`/`quotaNotice`. Resolve the target thread as the waking wake's `threadId` when it is owned by the weaver, else `threads.primaryThread()`; post with `threads.outbound({ kind:'system', id:null }, threadId, notice, { runId })`. Suppress when a retry is scheduled, when `hasOutboundForRun` says the turn already replied, on `interrupted_by_shutdown`/`interrupted_by_message`, and on `auth` (the auth gate owns that announcement). Verify: a new `engine.test.ts` case with a weaver agent whose fake runtime returns a typed adapter error shows one `thread_messages` row, `author_kind='system'`, naming the reason and carrying no run id.
- [x] 1.2 Call the new function beside `deliverSessionAnswer` in `executeRun` (`engine.ts:791`), so it runs after finalize and never fails the finished run. Verify: the weaver case above exercises the call; a session and a worker case are unchanged (no extra message).
- [x] 1.3 Expose `scheduledRetryAt: string | null` on `Run` in `packages/shared/src/types.ts` (projection of the existing `scheduled_retry_at` column). Verify: a runs/traces test asserts the field is returned for a run with a scheduled retry and null otherwise.

## 2. A retried conductor turn is not announced per attempt

- [x] 2.1 Test that a weaver turn failing with a retryable family (retry scheduled) posts no notice for that attempt, and that when the retry then succeeds only the turn's answer is in the thread. This case fails on the current code for the notice assertion and pins the "no spam" rule. Verify: `engine.test.ts`.
- [x] 2.2 Test that when the retry ladder is exhausted the weaver gets exactly one terminal notice (not one per attempt), and that a worker/session turn's failure path is unchanged. Verify: `engine.test.ts`.

## 3. The weaver chat renders a system notice

- [x] 3.1 In `packages/ui/src/v2/ChatMessage.tsx` (or just before it in `ChatConversation`'s row loop) add an early branch for `message.authorKind === 'system'`: centred, muted, attributed to `System`, no reply/jump affordances — the shape `SessionThreadFeed` uses (`WorkerPage.tsx:152`). Verify: a `v2chat.test.tsx` case passes a system `ThreadMessage` and asserts the notice rendering, and that an agent/human message is unchanged.
- [x] 3.2 Confirm the planner chat, which shares the component, is unaffected (no system messages in its fixtures). Verify: existing `ChatConversation`/plan-tab tests stay green.

## 4. The retrying state is shown, not messaged

- [x] 4.1 In `packages/ui/src/v2/ChatPage.tsx` derive `retrying` from `useWeaver().lastRun`: a non-running failed run whose `scheduledRetryAt` is in the future. Render a transient notice through an optional `ChatConversation` prop (so plan tabs pass nothing), clearing when `run.started` arrives or the instant passes, without writing to the thread. Verify: a `v2chat.test.tsx` case with a failed `lastRun` carrying a future `scheduledRetryAt` shows the retrying state, and one with no `scheduledRetryAt` shows nothing.

## 5. Verification and evidence

- [x] 5.1 `openspec validate vs-663-surface-a-weaver-turn-s-error-to-captain --json --strict` is clean.
- [x] 5.2 Iterate on the changed test files, then run `pnpm lint && pnpm typecheck` and the full suite one suite at a time with `--maxWorkers=4`, pasting both suite blocks verbatim in the report.
- [x] 5.3 Capture rendered evidence in both themes (dark, light) at desktop width of a failed weaver turn (system notice) and of a retrying turn. Attach each capture to the ticket (`weave_ticket_attachment_put`); author the harness outside `work/` and remove it, leaving `git status --porcelain` empty.
- [x] 5.4 State plainly in the PR and the report what was verified versus simulated: the failure path is driven by a fake runtime emitting a typed adapter error and the UI by the screenshot harness with mocked fetch; no real coding CLI was launched (repo rule), so the live Claude-adapter 500 path is unverified and named as needing the owner's confirmation.
