## Context

See `proposal.md` for why. Live measurements on 2026-09-11 against the fern-services workspace (344 MB sqlite, 276,940 `run_events`):

| Call | Time | Size |
|---|---|---|
| `GET /threads?channel=web` | 2.4 ms | 312 B |
| `GET /threads/:id/messages?limit=30` | 2.7 ms | 44 KB |
| `GET /conductor` | 10.4 ms | 7 KB |
| `GET /tickets?limit=200&includeTerminal=true` | 9.4 ms | **857 KB** |
| `GET /decisions?status=open,answered&owner=human&limit=200` | 6.7 ms | 264 KB |
| `GET /workers?includeRetired=true` | 5.2 ms | 200 KB |
| `GET /runs/traces` (agent, no `since`) | 11 ms | 252 KB |
| SQL `runs.traces` for 200 conductor runs | 3.2 ms | 7,899 events |
| `GET /api/health` (TLS public) | 8 ms | |
| SSE `/events` time-to-headers | 1.9 ms | |

The daemon is HTTP/1.1 only (`createHttpsServer` in `packages/server/src/daemon.ts`). Chrome/Firefox cap ~6 connections per origin. `EventSource` holds one for the life of the stream. VS-199 already made `/chats` itself hold one workspace `EventStream`; `AppShell` still mounts `FanInStreams` (one per workspace) on every other global page, and Live mounts `useRunEventStream` per working worker. A second tab does not share those sockets.

`Chat.tsx` `send()` awaits `post.mutateAsync` (the POST). Composer “Sending…” lasts until that promise settles. `setSending(false)` on success runs only from `run.finished` on the workspace stream — so a successful POST with a starved SSE still looks like a send in flight if the working glyph is misread, and a starved POST never leaves “Sending…”.

`node:sqlite` on this host is not the hang: the same queries are milliseconds with a reader on the live file.

## Goals / Non-Goals

**Goals:**

- REST for threads, messages, and send can complete while other tabs hold streams.
- `/chats` shows history when messages return; decorations cannot keep the skeleton up.
- Send in-flight UI ends when the POST settles (including a timeout).
- Ticket-chip fetches stop shipping descriptions.

**Non-Goals:**

- HTTP/2 on the public listener (revisit only if visibility-gating plus per-page caps are not enough under captain’s tabs).
- `run_events` retention or a purge job.
- Changing VS-199’s one-live-pane rule on `/chats`.
- Multiplexing all workspaces onto one daemon-wide EventSource (larger than this ticket unless the cap fix fails).

## Decisions

### 1. Pause streams on `document.hidden`, do not invent HTTP/2 in this change

`useLiveStream` and `EventStream` subscribe to `visibilitychange`. Hidden → `stop`/`close` the `EventSource`. Visible → `open()` with the existing `?after=` / `lastSeq` resume. Hidden is not `offline` and not a backoff increment.

Why not HTTP/2 first: it would fix the cap for every client, but it changes TLS serving, self-signed + HTTP/2 interop, and any reverse proxy story, with no proof yet that a single visible tab still starves. Why not a SharedWorker EventSource: more moving parts than visibility + the caps VS-199 already has. Why not “only one tab may stream” via `BroadcastChannel`: correctness is harder (which tab is elected, what happens on crash) than “hidden tabs don’t stream”.

A test drives a fake `document.hidden` and asserts the fake `EventSource` is closed, then reopened on visible with `after` set.

### 2. Keep VS-199’s per-page caps; do not add a numeric origin-wide counter in JS

The spec requires origin-wide room for REST. Implementation: hidden documents drop to zero streams, so two tabs cannot both hold Live’s N run-tails at once. The visible document still must not open more streams than `6 - 2` REST slots. Global Live today is `FanInStreams` (workspace count) plus one run-tail per live worker. With three workspaces and three running workers that is six — zero REST. On a **visible** Live page, keep `FanInStreams` (needed for invalidation) but do not open a run-tail EventSource until the cell is in view / the page is focused, **or** cap concurrent run-tails at two and page the rest as REST polls.

Chosen for apply: on Live, `useRunEventStream(..., { live })` is already gated on `streaming`. Additionally, only cells in the viewport (or the first two) pass `live: true` when `document.visibilityState === 'visible'`. FanInStreams stays, and is still paused when hidden (Decision 1). That leaves REST slots on a visible Live page with many workers.

### 3. Fetch timeout on send (and a global default for hanging GETs)

`api.ws` / `request` in `packages/ui/src/api/client.ts` takes an `AbortSignal`. POST `/threads/:id/messages` uses `AbortSignal.timeout(15_000)` (or a named constant). Timeout → `NetworkError` → existing Chat queue/failure path. GET `/threads` and GET `/messages` use a longer GET timeout (30s) so a starved request becomes `ErrorState` + retry instead of an eternal skeleton.

Why 15s not 2s: a large attachment upload on a slow link is still one request (VS-133). Why not wait forever: that is today’s bug. Idempotency key (VS-148) covers a timeout after the daemon already wrote.

### 4. `setSending(false)` when `mutateAsync` settles

On POST success, clear `sending` in the same `then` that resets reply/project. The working indicator then depends on `live?.running` / `run.started`, not on the composer lock. If the stream is down, `StreamStatusNotice` already exists; do not keep “Sending…” as a proxy.

### 5. Chat ticket list is lean; messages are not gated today — keep it that way and stop the 857 KB fetch

`useThreadMessages` already gates the skeleton (`messages.data === undefined`). Do not change that. `useTickets({ limit: 200, includeTerminal: true })` currently `SELECT *`. Add a list projection (id, identifier, title, status, projectId, createdByRunId, and whatever dispatch-labels already need) **or** a query param `fields=label` the tickets list honours. Chat and only chat uses it first. Descriptions stay on `GET /tickets/:id`.

Traces: do not enable `useRunTraces` until `oldestLoaded` or `messageRuns` is known, so first paint does not pull 200 conductor runs (11 ms / 252 KB; cheap here, still wasted).

### 6. `run_events` retention is a follow-up ticket

Record the numbers on VS-227 and in knowledge. Do not ship a purge in this change.

## Risks / Trade-offs

- **[Hidden Live tab stops streaming]** → Acceptable: the human is not looking; becoming visible replays from `after`. Mitigate with resume tests.
- **[Timeout fires after the daemon accepted the message]** → Idempotency key on retry; composer keeps text so a duplicate tap is the same key until they edit.
- **[Lean tickets miss a field dispatch-labels needs]** → Match the fields `chatEntries` / `DispatchLabel` actually read; add one field rather than `SELECT *` again.
- **[Visibility gating is not enough because one visible Live page still opens 6 streams]** → Decision 2’s in-view run-tail cap. If apply still sees starvation with only `/chats` visible, then HTTP/2 or a multiplexed bus — `ac_ask`, do not silently expand.

## Migration Plan

Client-only plus an optional tickets list query param (backward compatible: omitted → today’s full rows). No database migration. Rollback is revert.

## Open Questions

None that change the specs. Apply records authenticated HTTP timings of threads/messages **while** a background tab holds Live streams, in a test with a fake EventSource cap, not against the owner’s session.
