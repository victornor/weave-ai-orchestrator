## The cause, told apart from the candidates

The ticket lists four candidates. Reading the code settles it:

- **The card's visible state and the sort disagree — yes, and this is the cause.**
  `LiveCard` prints `agentUiStatus(cell.status)` (`packages/ui/src/v2/LivePage.tsx:100`), so a cell is
  visibly working only when `agent.status === 'running'`. The group is fed by
  `useRunningWorkerIds` (`packages/ui/src/lib/liveOrder.ts:47`), which holds a worker that just left
  the active set for `LIVE_RUN_GRACE_MS` (10s). `orderByRunning` then ranks every held worker inside
  the running group by `createdAt` (`liveOrder.ts:31`). A worker that finished its turn (status
  `active`, displayed idle) therefore stays in the running group for 10s and can be sorted between
  two genuinely-running cards. That is exactly the working → idle → working row captain saw.
- **Stale workers query — no.** `FanInStreams` invalidates each workspace's workers on live events
  and is mounted by the V2 shell on global pages (`V2Shell.tsx:421`).
- **The grace holds idle cards above working ones — this is a restatement of the cause.** The grace
  itself is wanted (VS-337): it is what stops a turn handover from bouncing a card down and back.
- **Per-workspace merge breaks the order — no.** `orderByRunning` sorts the merged cell list as one,
  so cross-workspace order already works.
- **The count — `liveWorkingAgents` (`packages/ui/src/lib/board.ts:53`) admits `provisioning`,
  `active` and `running`.** `useV2Counts` sums it, so workers between turns are counted as running.

## The fix

One derived state, `working`, per cell:

```
working = workingIds.has(cell.id)          // workingIds = raw running ∪ grace-held
visible = working ? 'working' : agentUiStatus(cell.status)
```

`workingIds` is the existing `useRunningWorkerIds` output, so the grace still smooths handovers —
but the held cell now *reads* working while it is held, the group and the label come from the same
value, and they cannot disagree. Once the grace elapses the cell reads idle and drops below the
working group in the same frame.

`useV2Counts` runs the same hook over the union of every workspace's working workers (the grace is
per worker id, so one call serves both the daemon-wide total and the per-workspace breakdown), and
returns `live` plus `liveByWs`. The rail's Live row keeps the global figure; the page header pill
uses the scope's, which is the per-workspace Live number.

The floor's own `N running · showing M` line becomes the number of shown cards that read working,
so it can never claim more than the cards show.

## Trade-off

A worker that finishes a turn is counted as working for up to 10s, while its card also reads
working. This keeps the sidebar and the floor in agreement, which is what the ticket asks for; a
worker idle longer than the grace is excluded.
