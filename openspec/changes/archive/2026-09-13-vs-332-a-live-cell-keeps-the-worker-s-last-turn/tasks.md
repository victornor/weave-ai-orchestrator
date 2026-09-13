## 1. The floor's latest-run data

- [x] 1.1 Add `const recent = useRuns({ limit: 200 })` to `LiveRoute`, build `lastRunByAgent` by keeping the first row per `agentId` (comparing `createdAt`), and pass a new `lastRun` prop to `LiveCell`. Verify the existing Live tests still pass with `pnpm --filter @weave-ai/ui exec vitest run src/test/liveFloor.test.tsx`.
- [x] 1.2 Add `useRunsMany(ids, { limit: 200 })` to `GlobalLiveRoute`, build each workspace's `lastRunByAgent`, carry it on the cell type, and pass `lastRun` to the shared `LiveCell`. Verify `pnpm --filter @weave-ai/ui exec vitest run src/test/globalLive.test.tsx`.

## 2. A finished run reads its newest events

- [x] 2.1 Add an optional `tail` (1..2000) query parameter to `GET /runs/:id/events` in `packages/server/src/routes/runs.ts`, returning `services.runs.tail(id, tail)` oldest-first when present and leaving the `after`/`limit` head path unchanged. Verify with a route case in `packages/server/test/app.test.ts`: a run with more than 500 events fetched with `?tail=500` returns its final events, not its first.
- [x] 2.2 Document `tail` on the runs line of `docs/API.md`. Verify the sentence names the parameter and its newest-window meaning.
- [x] 2.3 Add a newest-page mode to `useRunEvents` (`packages/ui/src/api/hooks.ts`) that requests `?tail=500`, and have `useRunEventStream` set it when the run is finished; `LiveCell` passes `newest: !streaming`. Verify the live path is untouched by re-running the existing Live streaming and VS-227 cases.

## 3. The cell keeps the last turn and hands off

- [x] 3.1 `LiveCell` accepts `lastRun`, resolves `current = activeRun ?? lastRun`, and drives `useRunEventStream(current?.id ?? null, { live: streaming && streamLive, newest: !streaming })` so a finished run loads its newest persisted events with no stream. Verify the existing streaming cases in `liveFloor.test.tsx` still pass.
- [x] 3.2 Render `current`'s transcript whenever it has events, render the waiting line alone when there is no run or a finished run with no events, and render "Waiting for the next turn." as a footer below the transcript when not streaming. Verify with the new finished-run and never-run tests.
- [x] 3.3 Retain the outgoing run's transcript in the cell (`kept` cache, updated only on a real id/count change) so a finished-to-active handoff shows the previous transcript until the new run has events, with no blank cell. Verify with the new handoff test.
- [x] 3.4 Keep `tailSlots` computed from active runs only, so a finished-run cell never opens or holds an `EventSource`. Verify the new tail-cap test and the existing VS-227 cases.

## 4. Tests

- [x] 4.1 In `liveFloor.test.tsx`, add: a live worker whose latest run is finished renders that transcript plus the waiting footer and opens no `EventSource`; a worker that has never run shows only the waiting line; a run moving from active to finished keeps the transcript on screen and shows the footer.
- [x] 4.2 In `liveFloor.test.tsx`, add: a finished run with more than 500 events renders its final events, not its first; a new run starting after a finished one switches the stream to the new run's id and renders its event; the VS-227 cap is unchanged, with finished-run cells taking no tail slot.
- [x] 4.3 In `globalLive.test.tsx`, add: a global cell whose worker is between turns shows the last run's transcript plus the waiting footer, and hands off to a new run without a blank cell.
- [x] 4.4 Confirm the mocks for `useRuns`/`useRunsMany`/`useRunEvents` route the new floor and newest-event queries through the test fixtures, then run `pnpm lint && pnpm typecheck && pnpm test` and record both suite blocks verbatim.
