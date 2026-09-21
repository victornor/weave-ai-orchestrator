## Why

A browser `EventSource` fires `onerror` only on a clean close. A half-open connection — a slept
laptop, a switched network, a proxy or tunnel that drops an idle stream without a close — leaves the
socket open with no frames and no error, so the web app stays `connected` on stale data until the
human reloads. Captain hit this on 2026-09-21: after ~30 minutes on the live page, workers looked
idle for 10 minutes while many had already finished; a refresh fixed it. The daemon already sends a
15-second heartbeat, but it is an SSE comment that `EventSource` never delivers to JavaScript, so no
client can tell a healthy idle stream from a dead one. The fix is to make the heartbeat observable
to the client and to give the client a watchdog that reconnects and re-syncs by itself.

## What Changes

- The daemon's SSE heartbeat changes from a `: ping` comment to a named `heartbeat` event carrying a
  timestamp and no `id`, so a browser client can observe it without moving its replay cursor. Applied
  by the one shared `heartbeat()` helper, so the workspace, daemon-wide, run and job streams all
  send it. Older clients ignore an event they never registered a listener for.
- Every persistent live stream in the web app gains a client watchdog: it tracks the time of the last
  received frame or heartbeat. Past ~2× the heartbeat (30s) it reports a new `stale` state; past ~2.5×
  (40s) it treats the socket as dead, closes it and reconnects with its latest `after=` position.
- A sleep/wake and tab-wake path: a watchdog tick whose wall-clock gap is far larger than scheduled
  (the machine slept), the browser `online` event, and `visibilitychange` back to visible all force a
  fresh reconnect instead of trusting the socket.
- Every reconnect performs a catch-up refetch of the queries the stream keeps fresh (workers, tickets,
  briefing, runs, decisions, workspace list), so a gap in events — a server restart, dropped frames,
  or an `after` position the server no longer has — cannot leave live counts or worker rows wrong.
- The connection indicators show `stale` honestly (last-frame clock) instead of a fresh `connected`.
- Server-side: each SSE write is bounded by a timeout; a slow or gone client whose write never
  completes has its stream aborted so the client reconnects, rather than a `Pump` loop stalling on it.

## Capabilities

### New Capabilities

- `live-streams/heartbeats`: the daemon's SSE keepalive contract for every live endpoint — an
  observable named heartbeat that carries no replay position, and a bounded write that drops a
  stalled client so it reconnects.

### Modified Capabilities

- `live-streams/connection-state`: the connection-state set gains `stale`; the online-reconnect
  requirement becomes a forced fresh reconnect; and the client watchdog, wake re-sync and
  catch-up-refetch requirements are added.

## Impact

- Server: `packages/server/src/sse.ts` (`heartbeat`, new bounded-write helper), the four SSE routes
  (`routes/events.ts`, `routes/runs.ts`, `routes/jobs.ts`), `openapi.ts`.
- Shared: `HEARTBEAT_MS` moves to `packages/shared/src/events.ts` so client thresholds and server
  cadence cannot drift.
- Web: `packages/ui/src/api/sseStream.ts` (watchdog, `stale`, resync hook), `api/events.ts` (both
  stream classes), `api/streams.ts`/`api/context.tsx` if a resync hook must thread through,
  `components/ConnectionBanner.tsx`, `components/StreamStatus.tsx`.
- CLI: `packages/cli/src/jobs.ts` must ignore an unrecognised frame (it currently treats one as the
  job finishing).
- Docs: `docs/API.md` heartbeat wording.
- No database, API shape, or dependency changes.
