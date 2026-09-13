## Why

When a worker's turn finishes, its Live cell throws away the transcript and shows only "Waiting for
the next turn." Captain loses the session that just happened at the exact moment it ends. The
transcript is already persisted and readable without a stream, so the cell can keep it.

## What Changes

- A Live cell with no in-progress run keeps showing its worker's **most recent** run's transcript,
  read from that run's persisted events with no live stream. "Waiting for the next turn." becomes a
  footer line under the transcript instead of replacing it.
- A finished run's transcript is read from the **newest** page of its persisted events, so a turn
  longer than one page shows its ending rather than only its opening. The page size and the
  live-streaming path are unchanged.
- A worker that has never run still shows the waiting line alone.
- When the worker starts its next run, the cell switches to that run's live stream without flashing
  a blank cell: the finished transcript stays on screen until the new run has content. A small turn
  separator between the two is optional.
- A cell whose turn just ended keeps its scroll position — at the bottom if the human was following,
  and where they left it if they had scrolled up.
- The most recent run for every live worker is fetched with one bounded query per floor (reusing
  `useRuns`), not one fetch per cell, and no new per-cell polling.
- The same behavior applies to global Live by virtue of sharing `LiveCell`; no second implementation.
- Finished-run cells never hold a run-tail `EventSource` slot (VS-227's cap is unchanged).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-navigation/live-floor`: a cell keeps the worker's last turn on screen between turns,
  hands off cleanly when the next turn starts, and preserves the cell's scroll position when a turn
  ends.
- `workspace-navigation/global-live`: a global Live cell keeps the worker's last turn the same way
  the per-workspace Live cell does.

## Impact

- `packages/ui/src/routes/Live.tsx` — `LiveRoute` builds the per-agent latest-run map from one
  bounded `useRuns` query; `LiveCell` gains a last-run prop, keeps the finished transcript, renders
  the waiting footer under it, and retains the outgoing transcript across a run handoff.
- `packages/ui/src/routes/GlobalLive.tsx` — the same latest-run map per workspace, passed to the
  shared `LiveCell`.
- `packages/ui/src/api/hooks.ts` / `packages/ui/src/api/runStream.ts` — `useRunEvents` learns a
  newest-page mode and `useRunEventStream` uses it when the run is finished, so all callers read a
  finished run's ending; the live path is untouched.
- `packages/server/src/routes/runs.ts` + `docs/API.md` — `GET /runs/:id/events` gains an optional
  `tail` (newest-window) parameter backed by the runs service's existing `tail()`; `after`/`limit`
  behavior is unchanged.
- `packages/ui/src/test/liveFloor.test.tsx`, `packages/ui/src/test/globalLive.test.tsx`,
  `packages/server/test/app.test.ts` — new cases for the finished-run transcript, the never-run
  worker, the active-to-finished transition, the handoff to a new run, the tail-slot cap, and a
  finished run longer than one page rendering its final events.
- No schema or `run_events` change, and no `RunTranscript` change.
