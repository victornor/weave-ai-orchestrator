## Why

VS-596 delivers a persistent session's turn answer and its failure notices to the session's conversation thread, but it derives the thread and the human message to quote from the waking wake. A turn the daemon stops on its own — a silence or hard-timeout watchdog cut — resumes on a `retry` wake built by the supervisor with only `{ retryOfRunId }`: no `threadId`, no `messageIds`. VS-596 has no fallback to the session's own thread, so that resumed turn posts nothing at all — not the answer, not a failure — which is exactly the silence captain complained about (the fern-ofm case was a 9-minute turn, the shape a silence watchdog cuts). The engine's own retried failure now carries the thread forward, but the watchdog's does not.

Two smaller gaps remain from the same ticket: a usage-limit notice does not give the reset time or say that nothing retries automatically, and an expired-login notice is not written at all.

## What Changes

- **A resume whose wake lost its thread context still reports.** When a session turn is stopped by the daemon and its later attempt runs on a retry wake with no thread context, the daemon resolves the session's own conversation thread, and delivers only while that thread still ends in an inbound human message with no answer after it. An unrelated self-scheduled turn therefore never answers a stale message, and the engine-scheduled retry keeps carrying its context as it does today (silent while the retry is pending).
- **A usage-limit notice names the limit, gives the reset time when the runtime reported one, and says nothing retries automatically, so another message is needed.**
- **An expired-login notice says a new login is needed and what happens next** — the conversation resumes once the login is renewed, or the human must log in and retry when the automatic recovery is exhausted and the work is parked.
- **`interrupted` keeps VS-596's behaviour**, including the web app's own Cancel: a plain interrupt that is not a shutdown or live-message resume says so in the chat. No behaviour is removed.
- No new thread primitive, no new tool, no schema change, and no run ids or internals in any notice. The watchdog-resumed path and the wording deltas gain tests; VS-596's working delivery is not replaced.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: extends the two requirements VS-596 introduces — a resumed turn whose wake carries no thread context resolves the session's own thread and answers only while a human message is still waiting there, and a session's ending notice gives the usage-limit reset and the manual next step, and speaks when a login has expired — without changing the existing delivery or interrupt behaviour.

## Impact

- **Core**: `packages/core/src/runs/engine.ts` — `sessionReplyContext` gains a fallback to the session's own thread (used by the delivery step and the retry-carry), guarded to retries and to a thread whose newest message is still an unanswered human message; `sessionOutcomeNotice` gains the usage-limit reset/manual-step wording and the expired-login notice.
- **UI**: no code change — VS-596 already renders every `authorKind: 'system'` thread message as the notice.
- **No** schema change, **no** migration, **no** new tool, and **no** change to the worker or planner reply paths. Does not backfill past sessions.
- **Depends on VS-596** (landed on `main` as `c4e60853`); this change builds on and preserves its delivery.