## 1. Shared ordering module

- [x] 1.1 Add `packages/ui/src/lib/liveOrder.ts` with `LIVE_RUN_GRACE_MS = 10_000` and a pure `orderByRunning<T>(items, key, runningIds)` that ranks items whose id is in `runningIds` first and otherwise keeps newest-`createdAt`-first with an id tie-break. Verify with a new `packages/ui/src/test/liveOrder.test.ts`: a running item sorts above a newer waiting item, each group is newest first, and equal timestamps break by id.
- [x] 1.2 Add `useRunningWorkerIds(activeIds)` to the same module: a worker that leaves the active set is held in `runningIds` for `LIVE_RUN_GRACE_MS`, a worker that re-enters is released at once, and pending timers are cleared on unmount. Verify with fake timers in `liveOrder.test.ts`: the stale id is present before the window and absent after; a re-entered id stays; unmounting clears the timer.

## 2. Per-workspace Live page

- [x] 2.1 In `packages/ui/src/routes/Live.tsx`, compute the active-id set from `live` and `runByAgent`, get `runningIds` from the hook, and render `orderByRunning(live, ...)` in place of `live`. Keep `tailSlots` computed from the canonical `liveWorkingAgents` order. Verify the existing `packages/ui/src/test/liveFloor.test.tsx` cases still pass with `pnpm --filter @weave-ai/ui exec vitest run src/test/liveFloor.test.tsx`.
- [x] 2.2 In `liveFloor.test.tsx`, add: with a mix of workers the running cells render before the waiting cells and each group is newest first; with fake timers a run ending keeps its cell in place until the grace window elapses and then moves it down, and a new run inside the window keeps it in place; the run-tail `EventSource` URLs and count are unchanged by the reorder; a moved cell keeps the saved size from sessionStorage.

## 3. Global Live page

- [x] 3.1 In `packages/ui/src/routes/GlobalLive.tsx`, compute the active ids across the flat cell list, get `runningIds` from the hook, and render `orderByRunning(cells, (c) => c.agent, ...)`. Keep `tailSlots` from the canonical order. Verify the existing `packages/ui/src/test/globalLive.test.tsx` cases still pass with `pnpm --filter @weave-ai/ui exec vitest run src/test/globalLive.test.tsx`.
- [x] 3.2 In `globalLive.test.tsx`, add: a running worker in one workspace renders before a waiting worker in another, and the order does not restart per workspace; the grace period keeps a just-finished global cell in the running group until it elapses.

## 4. Full verification

- [x] 4.1 Run `pnpm lint && pnpm typecheck && pnpm test` from `work/` and paste both suite blocks verbatim into the ticket. Confirm both the running-first order and the grace window behave as specified before requesting review.
