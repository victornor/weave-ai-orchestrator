## 1. Server heartbeat contract

- [x] 1.1 Move `HEARTBEAT_MS` into `packages/shared/src/events.ts` and import it in `packages/server/src/sse.ts` and the UI, so the cadence has one source; verify `pnpm typecheck` passes.
- [x] 1.2 Change `heartbeat()` to `writeSSE({ event: 'heartbeat', data: JSON.stringify({ at: <iso> }) })` with no `id`; verify a new `packages/server/src/sse.test.ts` asserts the frame is a named `heartbeat` event, carries a timestamp, and carries no `id`.
- [x] 1.3 Add `writeSse(stream, frame, timeoutMs)` that races the write against a timeout and calls `stream.abort()` on timeout, and make the send loops in `routes/events.ts` (both), `routes/runs.ts` and `routes/jobs.ts` break and close their `Pump` when it returns false; verify `sse.test.ts` with a fake stream whose write never resolves (fake timers) that the helper returns false and aborts.
- [x] 1.4 Harden `followJob` in `packages/cli/src/jobs.ts` to ignore a frame with no recognised `kind`; verify with a test that feeds a `heartbeat`-shaped `{}` item and asserts the follow promise is still pending.
- [x] 1.5 Update the heartbeat wording in `docs/API.md` (both SSE lines) and `packages/server/src/openapi.ts`; verify by grep that no "heartbeat comment" wording remains.

## 2. Client watchdog and stale state

- [x] 2.1 Add `SseWatchdog` plus `STALE_AFTER_MS`/`DEAD_AFTER_MS` and the `stale` state + `lastFrameAt` field in `packages/ui/src/api/sseStream.ts`, with a `heartbeat` listener that only touches the clock; verify a new `sseStream.test.tsx` case where a fake `EventSource` connects, emits a few frames, then goes silent, and after the dead window (fake timers) the hook closes it, reports `reconnecting`, and reopens with the latest `after=` — a test that fails on the unmodified hook.
- [x] 2.2 Wire the watchdog and `stale` transitions into `EventStream` and `GlobalEventStream` in `packages/ui/src/api/events.ts`, registering the `heartbeat` listener and keeping frame handling from re-notifying status listeners; verify a test that a stream receiving periodic heartbeats is never reconnected.
- [x] 2.3 Render `stale` honestly in `packages/ui/src/components/ConnectionBanner.tsx` and `packages/ui/src/components/StreamStatus.tsx` (last-frame age, not a fresh state); verify a component test asserting the stale notice appears for `stale` and not for `connected`.

## 3. Wake re-sync and catch-up refetch

- [x] 3.1 Add `resync(qc, ws)` in `packages/ui/src/api/events.ts` and call it from `EventStream.onopen` when `everConnected`, replacing the decisions-only invalidation; verify a test that a reconnect invalidates workers/tickets/briefing/runs/decisions/workspaces.
- [x] 3.2 Make `GlobalEventStream` track workspaces it has seen events for and re-sync each on reconnect; verify a test that a global reconnect invalidates both seen workspaces.
- [x] 3.3 Make `online` always force a fresh reconnect (unless hidden), and make the watchdog sleep-gap and `visibilitychange`-to-visible paths reopen and re-sync; verify `sseStream.test.tsx`/`events.test.ts` cases for the timer-gap, `visibilitychange` and `online` paths, including that the reconnect refetches the stream-backed reads.

## 4. Verification

- [x] 4.1 Confirm `packages/ui/src/test/connectionBudget.test.tsx` stays green with no extra connections per stream, and that the VS-227 hidden-tab behavior is unchanged.
- [x] 4.2 Iterate on changed test files, then run the full suite once with `--maxWorkers=4` (`pnpm test`) and paste both the core/server and UI suite blocks verbatim in the report.
