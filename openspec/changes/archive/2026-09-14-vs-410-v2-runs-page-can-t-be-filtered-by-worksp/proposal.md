# V2 Runs can be filtered by workspace and sorted

Tracker change for [VS-410](weave://tickets/VS-410). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

The V2 Runs screen (`packages/ui/src/v2/RunsPage.tsx`) merges one runs page per workspace and orders
the result by recency alone. It has a state filter but no way to narrow to a single workspace, and no
way to order by what a turn cost, how long it took, or how many tokens it spent. The runs API is
per-workspace, so widening the sort beyond the loaded page means the ordering has to happen in the
server's query, not over the rows the client already holds.

## What changes

- **A workspace filter** next to the state chips, listing every workspace by name (never an internal
  id). Choosing one queries only that workspace; `All` queries every workspace. It survives a reload
  through the URL.
- **A sort control** for cost, duration and tokens, ascending and descending, defaulting to the
  existing most-recent-first order. The chosen sort persists in the URL.
- **Server-side ordering.** `GET /runs` (and `RunsService.list`) gain `sort=createdAt|cost|duration|tokens`
  and `dir=asc|desc`. Cost reads `cost_cents`, tokens read the run's `usage_json` input+output, and
  duration reads the run's own clock (`finished_at`, or now while it is still running). Rows missing
  the sort key sort last; ties fall back to recency and id so paging is stable. The page fans the
  sorted query out per workspace and merges with the same comparator, so the most expensive run in
  the whole history is first under cost-descending even when it is beyond the first page.
- **In-progress runs** sort by their elapsed time so far and by their current cost and tokens.
- **Tests:** a core test for `RunsService.list`'s ordering (both directions, nulls last, default
  recency) and UI tests for the workspace filter, the sort control and the URL round-trip.
- **`docs/API.md`** documents the two new query parameters.

## Out of scope

The run detail page, charts, the Usage page, and the trace panes / Needs you counts / Work layout,
which are separate tickets. V1's Runs page is untouched.
