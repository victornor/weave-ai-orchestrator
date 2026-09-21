## Context

See proposal.md — Why. The pieces that shape the approach:

- The daemon serves SSE over plain HTTP/1.1 with a 15 s heartbeat written as the comment `: ping`
  (`packages/server/src/sse.ts` → `heartbeat()`), shared by four routes: `routes/events.ts`
  (per-workspace and daemon-wide), `routes/runs.ts`, `routes/jobs.ts`.
- `EventSource` never delivers comment lines to JavaScript, so a client has no signal that a stream
  stopped producing frames. `onerror` fires only on a clean close; `readyState` stays `OPEN` on a
  half-open socket. This was recorded as a known gap in VS-140, which worked around it by
  reconciling decisions on every reconnect.
- The web app has two SSE implementations. `EventStream` and `GlobalEventStream`
  (`packages/ui/src/api/events.ts`) carry the workspace and daemon-wide streams (including live
  counts, `worker.activity`, `run.event`/`run.delta`). `useLiveStream`
  (`packages/ui/src/api/sseStream.ts`) is used by the job stream. Both already close the socket on
  `document.hidden` (VS-227) and reconnect with a resume position.
- On reconnect, `EventStream` resumes with `?after=<lastSeq>` against a durable, monotonic `events`
  rowid, and the daemon replays `seq > after`. Ephemeral frames (`worker.activity`, `run.event`,
  `run.delta`, `session.compaction`) have `seq: 0` and are never replayed. A cursor the server no
  longer holds (a reset or replaced database) replays nothing.

## Goals / Non-Goals

**Goals:**

- A client can tell a healthy idle stream from a half-open one, and recovers by itself.
- Recovery is visible and honest: the indicator never claims fresh data on a silent socket.
- A gap in events (dropped frames, a missed ephemeral frame, a lost resume position) converges from
  the authoritative reads.
- A stalled server-side write cannot hold a stream loop open forever.

**Non-Goals:**

- Reworking the workspace/global stream split, the one-connection-per-document budget, or the
  hidden-document pause (all unchanged; `connectionBudget.test.tsx` must stay green).
- Persisting ephemeral frames or adding an outbox row for them.
- A server-side push of missed ephemeral frames; the catch-up is a client read, not a replay.
- Detecting a stalled stream on a stream that is intentionally paused (`hidden`, `offline`).

## Decisions

**1. The heartbeat becomes a named `heartbeat` event.** `heartbeat()` writes
`event: heartbeat\ndata: {"at": "<iso>"}\n\n` — no `id`, so the client's replay cursor cannot move
and nothing is replayed. The handler is shared, so all four endpoints change together.
*Alternatives:* keep the comment and rely on `onerror` (does not fire on a half-open socket);
open a second `EventSource` just for liveness (spends the HTTP/1.1 budget this project guards);
send an unnamed `data:` frame (delivered to `onmessage` and confused with real frames). A named
event is additive and self-describing.
*Compatibility:* a browser client that registered no `heartbeat` listener ignores it. The one
in-repo consumer that parses every frame is the CLI job follower (`packages/cli/src/jobs.ts`): it
treats any `JobStreamItem` whose `kind` is not `step`/`log` as the job finishing, so a heartbeat
would end `weave … --follow` early. Harden it to require a known `kind`. Every other consumer
(`cli/commands/runs.ts`, `cli/commands/conversation.ts`, the TUI apps) already filters on event
type. A CLI binary built before this change and still running across a daemon upgrade is the
residual exposure; the CLI ships from the same release as the daemon.

**2. One watchdog helper, two thresholds, derived from a shared cadence.**
`HEARTBEAT_MS` moves to `packages/shared/src/events.ts`; the server imports it and the web derives
`STALE_AFTER_MS = 2 × HEARTBEAT_MS` (30 s) and `DEAD_AFTER_MS = 2.5 × HEARTBEAT_MS` (40 s, rounded).
A single `SseWatchdog` in the UI owns one repeating tick (5 s, chosen to divide both thresholds so
transitions are deterministic under fake timers). Each tick: if `now - lastTickWall` is far larger
than the tick interval, the machine slept → `onWake`; else compare `now - lastFrameAt` to the
thresholds and call `onStale`/`onDead`. `touch()` is called on every frame and every heartbeat and
only stores an epoch value — it does not notify status listeners, preserving VS-417's rule that a
busy turn must not re-render every subscriber.
*Alternatives:* a single timer per stream (more timers, no sleep detection); watching only on the
workspace stream (the job stream would keep freezing); duplicating the literal cadence in the UI
(client and server drift).

**3. A new `stale` connection state, shown honestly.** `ConnectionState` gains `stale`;
`ConnectionStatus` gains `lastFrameAt`. `connected → stale` is a normal status transition (so it
does re-render the indicator once), `stale → connected` on the next frame. `ConnectionBanner` and
`StreamStatusNotice` render `stale` as "no updates since <lastFrameAt>" rather than a fresh state.
*Alternatives:* fold stale into `reconnecting` (claims the socket dropped when it has not);
reuse `capturedAt` (it means event time, not receipt time, and the two differ after a sleep).

**4. Catch-up refetch is a reconnect-time invalidation of a fixed root set.** Add a `resync(qc, ws)`
helper next to `invalidateFor` that invalidates `workers`, `tickets`, `briefing`, `runs`,
`decisions` and `workspaces` for the workspace. `EventStream` calls it from `onopen` when
`everConnected` (replacing VS-140's decisions-only call). `GlobalEventStream` accumulates the
workspace ids it has seen an event for and re-syncs each of them. `useLiveStream` exposes an
optional `onResync`; the job stream needs none because the job endpoint replays its steps and log
from the start on every connect. Invalidation is only fired on an actual reconnect, and an
unfetched query is a no-op.
*Alternatives:* invalidate the whole cache (wasteful, and refetches unrelated settings); replay
ephemeral frames (they are never persisted, so impossible); rely on the durable replay alone (it
cannot cover ephemeral frames or a lost cursor).

**5. Wake paths force a *fresh* connection.** `online` always closes and reopens (unless hidden),
instead of only when the state is not `connected`. `visibilitychange` to visible already reopens;
it now also re-syncs. A watchdog sleep gap forces a reopen and re-sync. All three land on `onopen`,
so the decision-4 refetch covers them too.

**6. Server writes are bounded.** Add `writeSse(stream, frame, timeoutMs)` to `sse.ts`: it races the
`writeSSE`/`write` promise against a timeout and, on timeout, calls `stream.abort()` and returns
`false`. The route send loops break and close their `Pump` when a write fails, so a client that
never drains is dropped and will reconnect. Timeout starts at 10 s (well under the client's 40 s
dead window, so the client still sees a clean close).
*Alternatives:* a socket-level timeout (not reachable through Hono's streaming API); leaving it
(slow-client stalls are the second half of the freeze the ticket names).

## Risks / Trade-offs

- **[A named job-stream heartbeat ends an old CLI follow]** → Harden `followJob` in the same
  release; the CLI and daemon ship together. State the residual exposure in the PR.
- **[Reconnect storms on a flaky network]** → The dead window is 40 s and the backoff ladder is
  unchanged; a stream that is truly down already retries, and the extra work on success is one set
  of cache invalidations.
- **[Refetching on every reconnect is extra load]** → Only on reconnect, and only the roots the
  stream feeds; durable events are also replayed in the same window, so the two are concurrent, not
  doubled.
- **[Fake-timer determinism]** → The 5 s tick divides both thresholds, so `advanceTimersByTime`
  hits the transitions exactly.
- **[`stale` ripples to every state check]** → Existing checks compare against `connected`,
  `offline`/`unreachable` or `hidden`; `stale` falls through to the "show a notice" branch, which is
  the intended display. Update the two indicator components explicitly.

## Migration Plan

No database, API-shape or dependency change, and no feature flag: the daemon and the web bundle ship
from one release. A tab loaded before the upgrade keeps the old JS until it reloads, and an old
tab's client ignores the new named heartbeat. Rollback is reverting the release; the only server
state affected is transient.

## Open Questions

None.
