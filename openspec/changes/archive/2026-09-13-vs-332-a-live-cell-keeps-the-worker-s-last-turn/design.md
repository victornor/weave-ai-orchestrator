## Context

`LiveRoute` (`packages/ui/src/routes/Live.tsx`) and `GlobalLiveRoute`
(`packages/ui/src/routes/GlobalLive.tsx`) build an `agentId -> active Run` map from `useRuns({ status:
'running' })` and `useRuns({ status: 'queued' })`, keeping only `isActiveRun` rows. `LiveCell` calls
`useRunEventStream(activeRunId, { live: activeRun && streamLive })` and renders
`streaming ? <RunTranscript live/> : <p>Waiting for the next turn.</p>`. When a turn ends the map loses
the run, the run id becomes `null`, and the transcript is replaced by the waiting line.

`useRunEventStream(id, { live: false })` (`packages/ui/src/api/runStream.ts`) already serves a
finished run: it keeps the persisted-events query and opens no `EventSource`. But that query is
`useRunEvents(runId, 0)`, which requests `/runs/:id/events?after=0&limit=500` — the run's **first**
500 events. A cell that streamed the run keeps everything its tail buffer already holds; a cell that
never streamed it (opened after the worker went idle, reloaded, or sat past the VS-227 tail cap)
would show only the opening of a long turn, with the ending missing. The finished-run path therefore
needs the newest window, not the first page. The `RunTranscript` `live` prop already means "follow the
bottom while content arrives"; turning it off suppresses auto-scroll without repositioning
(`packages/ui/src/lib/stickToBottom.ts`).

See proposal.md for the motivation and the modified capabilities.

## Goals / Non-Goals

**Goals:**
- A cell between turns shows its worker's most recent run's transcript with the waiting line as a
  footer, or the waiting line alone for a worker that has never run, and that transcript includes the
  run's final events even when the run is longer than one page.
- The active-to-finished transition keeps the transcript and the scroll position already on screen.
- A finished-to-active handoff opens the new stream with no blank cell in between.
- The latest run comes from one bounded query per floor, with global Live reusing the same cell.

**Non-Goals:**
- No schema or `run_events` change, and no new polling loop.
- No change to the VS-227 tail cap, to `RunTranscript`, or to `mergeRunEvents`.
- No history browser: only the worker's single most recent run is kept, not a list of past turns.
- No change to who gets a cell (the liveness rule and terminal-ticket exclusion stay as they are).

## Decisions

**One `useRuns` query per floor, not one per cell.** `LiveRoute` adds
`const recent = useRuns({ limit: 200 })` and builds `lastRunByAgent` by walking the newest-first
result and keeping the first row per agent (comparing `createdAt`, so ordering assumptions cannot
silently break it). `GlobalLiveRoute` adds the same query through `useRunsMany(ids, { limit: 200 })`,
one per workspace, matching how the existing running/queued queries already fan out. Rejected: a new
server endpoint returning the latest run per agent (expands the API surface and `docs/API.md` for a
window the floor already covers); one `useRuns({ agent })` call per cell (explicitly excluded by the
ticket and an N-query fan-out).

The active map still comes from the status-filtered running/queued queries. Those queries guarantee
an in-progress run is found no matter how many newer finished runs exist; folding active detection
into the unfiltered window would regress a long-running turn. The extra query is only the fallback
transcript.

**The cell resolves `activeRun ?? lastRun`.** `LiveRoute`/`GlobalLiveRoute` pass both `run` (active,
as today) and `lastRun` (the fallback). `LiveCell` computes `streaming = Boolean(run &&
isActiveRun(run.status))`, `current = streaming ? run : lastRun`, and calls
`useRunEventStream(current?.id ?? null, { live: streaming && streamLive, newest: !streaming })`.
Rendering follows: `currentEvents.length > 0` renders `current`; a streaming handoff with no new
events renders the outgoing transcript retained in the cell; a finished run with no events renders the
waiting line alone. `RunTranscript` gets `live={streaming}`, so following happens only while the run
is active and a just-finished cell is never repositioned.

**A finished run reads the newest window.** `GET /runs/:id/events` gains an optional `tail` parameter
(1..2000) that returns the run's newest events oldest-first via the runs service's existing `tail()`
(`packages/core/src/runs/index.ts`), alongside the unchanged `after`/`limit` head query. `useRunEvents`
grows a newest-page mode that requests `?tail=500`, and `useRunEventStream` sets it when the run is
finished — `LiveCell` passes `newest: !streaming`, so the active path is byte-for-byte what it is
today (including a cell past the tail cap, which is still `streaming === true`). Because the SSE replay
already starts at seq 0, a cell that streamed the turn holds the whole transcript through its tail
buffer, so flipping to the newest window on finish cannot shrink what is on screen; a cell that mounts
finished loads the ending directly. Alternatives: paging backward with repeated `after` requests
(N round trips, and still needs a count); computing `after` from `runs.traces`' event count (a second
floor query and an assumption that `seq` is contiguous); raising `limit` to 2000 (still the oldest
page, still truncates the ending on a longer run).

**Retain the outgoing transcript in the cell, not in the parent.** The parent's `lastRun` becomes the
new active run the moment it starts, so it cannot supply the previous turn during a handoff. The cell
keeps a `kept: { run: Run; events: RunEvent[] } | null` cache, updated by an effect only when
`current` has events and the id or event count changed (returning the previous value otherwise, so
the effect cannot loop). While `streaming` and `currentEvents` is empty, the cell renders
`kept.events` instead of an empty box; the first event of the new run swaps it out. No separator is
required; a turn marker between the two is permitted but not implemented.

**Scroll retention falls out of the existing hook.** The `RunTranscript` stays mounted across the
active-to-finished transition (same run id, same element), so `useStickToBottom` holds its offset;
flipping `follow` from true to false only stops future auto-scrolling. No new scroll code.

## Risks / Trade-offs

- [The bounded 200-row window may not contain a live worker's most recent run if the workspace
  produced more than 200 newer runs since it] → A live worker is actively dispatched, so its last run
  is recent by construction, and 200 matches the limit the existing running/queued floor queries use.
  If a straggler appears the cell falls back to the waiting line, exactly today's behavior — a
  missing transcript, never a wrong one.
- [The retention effect could re-render in a loop] → The updater returns the previous state when the
  id and event count are unchanged, so only a real change schedules a render.
- [A finished run with no persisted events] → Renders the waiting line alone rather than an empty
  transcript box.
- [The newest window omits the opening of a turn longer than 500 events] → Deliberate: the ticket wants
  the turn that *just happened* with the waiting line under it, and the ending is what was missing. A
  cell that watched the turn still holds the whole transcript from its stream; only a freshly-mounted
  cell for a very long turn starts 500 events in.
- [The new `tail` parameter widens a shared read route] → It is additive and defaults off, the `tail`
  service method already exists and is unit-tested (`packages/core/src/runs/tail.test.ts`), and the
  route gets its own case plus a `docs/API.md` entry.
