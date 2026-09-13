## Context

See proposal.md - Why. Both Live pages take their cells from `liveWorkingAgents`
(`packages/ui/src/lib/board.ts`), which filters to live workers and sorts by `createdAt` descending.
Each page separately builds a `runByAgent` map of active runs (`isActiveRun`) and a
`lastRunByAgent` fallback, then renders `LiveCell`s keyed by agent id. Global Live emits its cells
workspace-by-workspace but renders them in one flat `grid grid-flow-dense`; it has no per-workspace
sections. `tailSlots` is `liveRunTailSlots(streaming ids)` and, today, is computed by filtering the
`liveWorkingAgents` order to active runs, so it always picks the two newest active workers. Saved
sizes live in sessionStorage keyed by worker id (`lib/liveCellSize.ts`).

Constraints: no server, shared or API change; the VS-227 stream cap and the existing membership rule
stay; the dense grid and saved sizes must keep working.

## Goals / Non-Goals

**Goals**

- Running-first ordering on both pages, newest-first inside each group, shared between the pages.
- A between-turns grace period so a cell that finishes a turn does not drop to the bottom and bounce
  back when the next turn starts moments later.
- Reordering provably leaves stream slots, open streams and saved sizes untouched.

**Non-Goals**

- No group divider or label between the two groups (proposal records this).
- No change to who has a cell, to `liveWorkingAgents`, to `liveRunTailSlots`, or to the terminal-
  ticket exclusion.
- No restructuring of global Live into per-workspace sections.

## Decisions

**One shared pure sort plus one shared hook.** New module `packages/ui/src/lib/liveOrder.ts`
exports:

- `LIVE_RUN_GRACE_MS = 10_000` — the single grace constant both pages and the tests read.
- `orderByRunning<T>(items, key, runningIds)` — a pure sort. `key(item)` returns `{ id, createdAt }`.
  An item whose id is in `runningIds` ranks before one that is not; ties inside a rank keep the
  existing newest-`createdAt`-first order with an id tie-break, matching `liveWorkingAgents`.
- `useRunningWorkerIds(activeIds)` — the grace hold, described below.

Both routes call the same two pieces, so the order cannot drift between them. Rejected: putting the
sort inside `liveWorkingAgents` (it has no notion of runs and the board must not change); duplicating
the comparator in each route.

**The grace hold is a timer-driven set in the hook, not a timestamp comparison.** The hook keeps a
`held` set and a `ref` of pending timers. On each change of the active-id set it adds every worker
that just left the set to `held` and schedules a `setTimeout(LIVE_RUN_GRACE_MS)` that removes it;
a worker that (re)enters the active set has its pending timer cleared and is dropped from `held`.
It returns `activeIds ∪ held`. A worker's group must be able to change ten seconds after a turn
ends with no new server data arriving, so a state write at expiry is required to re-render, and the
worker has no active run to read a timestamp from. Rejected: deriving the group purely from
"when did this id last appear active" (never re-renders at expiry on its own); a one-second
`setInterval` (wakes both pages every second for a change that happens once per turn); doing this in
each route (two copies of the same timer bookkeeping).

**Tail slots are computed from the canonical order, before the reorder.** `LiveRoute` keeps
`live = liveWorkingAgents(...)` and `tailSlots = liveRunTailSlots(live.filter(active).map(id))`
unchanged; only the rendered array becomes `orderByRunning(live, ...)`. `GlobalLiveRoute` does the
same over its flat cell list. This makes "the reorder does not change which cells hold a stream" true
by construction — the slot input does not see the new order. (The active items in the new order would
happen to yield the same first two, since both preserve `createdAt` descending, but reading the
canonical order does not rely on that.) `LiveCell`s stay keyed by agent id, so a position change is a
reorder, not a remount, and no `EventSource` is dropped or reopened.

**Global Live orders across the whole page.** The page is one grid, not per-workspace sections, so a
single `orderByRunning` over the flat `cells` list. Rejected: grouping by workspace first (changes
the page's structure beyond this ticket).

**Saved sizes need no change.** `sizeOf(sizes, id, ...)` is already keyed by worker id and the cell
is not remounted, so a moved cell keeps its size; this is covered by a test rather than new code.

## Risks / Trade-offs

- [A timer for a worker that leaves the live set entirely lingers until it fires] → It only writes
  the `held` set for an id no longer rendered; it is removed on expiry and all timers are cleared on
  unmount.
- [The 10s window is a product guess] → It is one exported constant, easy to tune, and the ticket
  names "about 10 seconds".
- [A grace-held cell keeps a waiting worker in the running group visually for 10s] → Intended: the
  ticket trades a few seconds of staleness for no flapping across a turn handoff.
- [Reordering under `grid-flow-dense` changes which sizes pack where] → Dense flow is unchanged and
  per-cell sizes are unchanged; only the array order differs, which is the requested behaviour.

## Migration Plan

Frontend-only, no data or API migration. Land behind the normal UI build; rollback is reverting the
commit.
