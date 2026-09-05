## Context

See `proposal.md` — Why. What matters for the design:

- The queue is **per project** by construction (`packages/core/src/tickets/merge-queue.ts`): `forProject(projectId)` returns `{ projectId, concurrency, active, waiting }`, and `GET /projects/:id/merge-queue` is the only read surface. There is no workspace-wide queue endpoint.
- An entry already carries everything a row needs except history: `{ ticketId, identifier, title, projectId, position, queuedAt, startedAt, workerId }`. Elapsed time is `startedAt`/`queuedAt` against now; the merge turn's transcript is the worker page for `workerId` (`/w/:ws/workers/:workerId`), which already streams the live run.
- Nothing records queue history. `leave()` clears `merge_queued_at` and `merge_started_at`, so once a ticket is out of the queue its row says nothing about having been in one. But the ticket service already writes `activity` rows for every relevant moment: `ticket.merged` on a completed merge (`service.ts:777`), `ticket.transition` with `{from, to}` on every transition (`service.ts:324`), and `ticket.cancel` with `{from}` (`service.ts:614`).
- The board already loads every non-terminal ticket (`useTickets({ limit: 300 })`), and `Ticket` carries `mergeQueuedAt` and `mergeStartedAt` (`packages/shared/src/types.ts`). So "how many are merging / waiting" is answerable on the board with no request at all.
- Layout system: `Page` / `PageHeader` / `PageBody` with `px-4 md:px-5` horizontal padding, `ac-card` panels, `Segmented` for switchers, `EmptyState` / `ErrorState` / `SkeletonRows` for the three non-happy states, status hues from the nine tokens (`merging` `#A472F5`, `done` `#3FB950`, `failed` `#E5484D`).

## Goals / Non-Goals

**Goals:**

- One deliberate home for "what is landing", reachable at all times, laid out on the same grid as every other page.
- The board reads as one page again: columns, filters, nothing floating.
- Answer "did VS-53 land?" without leaving the view.
- No new writes, no migration, no change to how the queue admits.

**Non-Goals:**

- A combined all-projects landing view. The queue is per project; the route switches between them.
- Live-tailing the merge transcript inside the queue view — it links to the worker page, which already does that.
- Touching the CLI table or the TUI.

## Decisions

### D1. A dedicated route, entered from a strip on the board — option (a) plus (c), not (b)

The ticket offered three placements. Judged against what the view has to hold (merging now with elapsed time and a log link, waiting in order, concurrency, recent landings and failures):

| Option | Verdict |
|---|---|
| (b) fold into the board's In review column | Rejected. The column is a list of ticket cards of one shape; a "landing" section with its own concurrency line and a recent-outcomes list would be a second layout inside one column, at 224 px minimum width. Recent landings are `done` tickets — they belong to a different column, so the section would either duplicate cards or contradict the fold. It also keeps the queue tied to a page about ticket ownership, which is not what landing is about. |
| (c) a status strip in the board header alone | Rejected as the whole answer. A strip cannot hold elapsed time, positions, concurrency and history. It is, however, exactly the right *entry point*. |
| (a) a place of its own | Chosen. The content is a page: three sections plus an empty state, and it wants room at 1440 px without stealing it from the columns. |

So: **(a) is the destination, (c) is the door.** The strip lives in the board's filter bar, the page holds the picture.

### D2. `/w/:ws/merge-queue?project=<id>`, not a rail entry

The route is registered in `packages/ui/src/router.tsx` with `searchPassthrough`, exactly like `/board`, and reads `?project=` through `useSearchParams()` (`app/link.tsx`), the pattern VS-51/VS-52 settled for addressable views. The project falls back to the first project in the workspace when the search names none or names one that no longer exists — the same "look up by key, fall back to the first" rule Settings uses for `?section=`.

It does **not** join the desktop rail. DESIGN-CONTRACT §3 fixes the rail at eight entries with keyboard numbers `1`–`7` and `,`, and the phone bar at five tabs ("six targets do not fit at 390px"); a ninth destination for something that is empty most of the time would cost more than it returns. Both entry points — the always-present board strip and the ticket page badge — sit exactly where someone asking "is it landing?" already is. This is recorded in the contract update, not left implicit.

**Alternative considered:** a `?section=` tab on the Board page. Rejected: the board's own view switcher (Kanban/Table) already occupies that slot, and the queue is not a view of the ticket list.

### D3. Recent outcomes are derived from `activity`, not stored

`recentOf(projectId, limit)` reads `activity` joined to `tickets` on `activity.ticket_id`, restricted to the workspace and `tickets.project_id`, ordered by `activity.created_at DESC`, taking:

| Row | Outcome |
|---|---|
| `action = 'ticket.merged'` | `landed`; `mergeCommit` from `details_json.mergeCommit` |
| `action = 'ticket.transition'` and `details_json.from = 'merging'` and `to = 'blocked'` | `failed` |
| `action = 'ticket.transition'` and `details_json.from = 'merging'` and `to` is anything else | `withdrawn` |
| `action = 'ticket.cancel'` and `details_json.from = 'merging'` | `withdrawn` |

One row per ticket, most recent kept, capped at 5 by default. A merge that completed does not also produce a `ticket.transition` row (`mergeDone` writes the status through `touch`, not `transition`), so nothing is double counted.

**Why not a new column or table:** the fact is already recorded, and a new write path on the merge turn is a change to how merging works — which the ticket puts out of scope. The trade-off is a `LIKE`/`json_extract` read over `activity` rather than an indexed lookup; with a limit of 5 over a workspace-scoped, time-ordered index this is a page view, not a hot path.

**Why `withdrawn` rather than folding it into `failed`:** a ticket sent back for changes did not fail to merge, and reading it as a failure would be wrong the moment someone uses the view to judge whether the project's merges are healthy.

### D4. The board strip is derived, not fetched

`mergeStrip(tickets)` in `packages/ui/src/lib/board.ts` counts `status === 'merging'` split by `mergeStartedAt`, over whatever the board is currently showing. Consequences: no query, no loading state, present at every filter, and it cannot disagree with the columns beside it. `useMergeQueue` leaves `Board.tsx` entirely; the route owns it.

The strip does not show concurrency or positions — those need the per-project queue, and the strip's job is to say "something is landing, here is where to look".

### D5. Layout

**Desktop (≥ md).** `PageHeader title="Merge queue"`, `meta` = the project's slug, `actions` = the project `Segmented` when the workspace has more than one project. Body is a single 56 rem column, `px-5 py-4`, `space-y-4` between sections — no card floats, every section is a full-width panel with a `SectionLabel`:

```
┌ Merge queue · web ──────────────────────  [ web | api | infra ] ┐
├─────────────────────────────────────────────────────────────────┤
│  LANDING NOW                                    1 of 1 slots    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ◆ VS-53  Full test suite exits cleanly again          4m12s│  │
│  │   Platform Engineer #53 · merging                          │  │
│  │   Open the landing log →                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  WAITING  2                                                     │
│   #1  VS-56  Knowledge graph keeps its selection      waited 8m  │
│   #2  VS-57  Usage page groups by model              waited 3m   │
│                                                                 │
│  RECENTLY LEFT THE QUEUE                                        │
│   ● landed     VS-52  Settings separates daemon-wide…  2h ago   │
│   ● landed     VS-51  Sidebar shows an update entry    3h ago    │
│   ● failed     VS-49  Stuck-worker retry card          5h ago    │
└─────────────────────────────────────────────────────────────────┘
```

Rows are the same height and rhythm as `TicketRow`; the leading glyph is the status token (`merging` for the active card, `done` / `failed` / `idle` for the outcomes), so a coloured pixel still means state. The active entry is the only card, because it is the only thing that is happening.

**Phone (< md).** Same three sections, stacked, full-bleed rows with `px-4`; the project switcher becomes the same horizontally scrolling pill row the board uses for statuses. The landing card drops the worker line to two lines: title, then `merging 4m12s · open log`. No horizontal scrolling anywhere, nothing narrower than 320 px.

**The board strip.** Inside the existing filter bar container (`flex-none border-b border-line-1 px-4 py-2 md:px-5`), as a row under the filters, separated by `mt-2 pt-2 border-t border-line-1` when filters are present:

```
◆ Merge queue · 1 landing · 2 waiting                              →
```

Idle: `Merge queue · nothing landing`, `text-text-4`, same row, same height — the board's geometry never changes with the queue's state, which is the whole complaint being fixed.

### D6. `MergeQueuePanel` is deleted, `MergeQueueBadge` gains a link

Nothing renders the panel after this change, so it goes rather than lingering as dead code; its three tests in `components.test.tsx` are replaced by tests for what took its place. `MergeQueueBadge` keeps its `{ position, merging }` props and gains an optional `to` — absent, it renders exactly as today, so the ticket page's badge cannot regress.

## Risks / Trade-offs

- **The `activity` scan grows with the workspace's history** → the query is bounded by `LIMIT`, ordered on the existing `activity(workspace_id, created_at)` index, and read only when the merge-queue view is open. If it ever shows up, the answer is an index on `activity(ticket_id)`, not a new table.
- **`details_json` is untyped, and a future rename of `from`/`to` would silently empty the recent list** → the derivation is one function with its own tests covering each outcome; a rename breaks a test rather than a page.
- **The route can be opened for a project the workspace no longer has** → falls back to the first project, the same rule as Settings' unknown `?section=`, never an error state.
- **A queue view that is empty most of the time is a page people rarely open** → mitigated by the strip being permanent and quiet: the entry point is what carries the signal, and the page is where the detail lives. If the human later wants it in the rail, that is a one-line nav change.
- **Two places now count what is merging** (the strip from board tickets, the page from the queue endpoint) **and could briefly disagree** → both are invalidated by the same `ticket.*` stream events; a difference lasts one refetch and neither is an action surface.
