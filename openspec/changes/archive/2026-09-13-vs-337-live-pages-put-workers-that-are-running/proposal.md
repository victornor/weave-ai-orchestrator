## Why

The Live page orders cells only by worker age, so a row of workers that are merely
"Waiting for the next turn" can sit above the workers actually running a turn. Since VS-332 a
waiting cell keeps its last transcript on screen, so it takes real space and the page no longer
reads at a glance as "who is working now". Captain wants the running workers at the top.

## What Changes

- Both Live pages order cells so workers with an **active run** (running or queued,
  `isActiveRun`) come first, and all other live workers after.
  - Within each group the existing order is kept: newest worker `createdAt` first. A cell moves
    only when it changes group.
  - Global Live has no per-workspace grouping today (one flat grid), so the order applies across
    the whole page.
- **No flapping.** A cell stays in the running group for a short grace period after its run ends
  (about 10 seconds), so the common "turn ends, next turn starts moments later" handoff does not
  bounce it to the bottom and back. A new active run inside the window keeps it in place.
- **Streams stay put.** The VS-227 tail-slot assignment is computed from the canonical
  `liveWorkingAgents` order, before reordering, so which cells hold an `EventSource` is unchanged.
  Moving a cell in the grid does not remount it, so it neither drops nor reopens its stream.
- **Sizes and layout.** Saved sizes stay keyed by worker id
  (`conductor.live.cellSizes.<ws>`), so a moved cell keeps its size; the dense grid is unchanged.
- The order is one shared pure function plus one shared hook, used by both pages, not a second
  implementation per page.
- No divider or label is added between the groups (see design): a full-width divider inside a
  dense, row-spanning, drag-resizable grid reads inconsistently, and the ordering is what was
  asked for.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-navigation/live-floor`: cells are ordered running-first with a between-turns grace
  period, without changing stream assignment, cell size or the dense grid.
- `workspace-navigation/global-live`: the global Live grid applies the same running-first order
  across the whole page.

## Impact

- `packages/ui/src/lib/liveOrder.ts` (new) — `LIVE_RUN_GRACE_MS`, a pure `orderByRunning` helper
  and a `useRunningWorkerIds` hook that holds a just-finished worker in the running group for the
  grace window.
- `packages/ui/src/routes/Live.tsx` — `LiveRoute` computes the active ids and renders the ordered
  list; `tailSlots` keeps reading the canonical `liveWorkingAgents` order.
- `packages/ui/src/routes/GlobalLive.tsx` — the same active-id/order computation over the flat
  cell list; the same tail-slot treatment.
- `packages/ui/src/test/liveFloor.test.tsx`, `packages/ui/src/test/globalLive.test.tsx`, and a new
  `packages/ui/src/test/liveOrder.test.ts` — running-first order, grace and no-flap with fake
  timers, a moved cell keeping its stream and its saved size, and Global Live ordering.
- No server, shared, schema or API change; no change to who gets a cell or to `liveRunTailSlots`.
