## Why

Captain asked for a workspace-level live floor: one page that shows every worker currently on a ticket, with that worker's output streaming as it happens. The web app already has the pieces — live transcripts on the ticket page, the Run page and the worker page (VS-59), and a live-vs-paused worker split that excludes `paused` from the working set (VS-137, `liveWorkersByTicket` / `isLiveWorker` in `packages/ui/src/lib/board.ts`) — but they are all per-ticket or per-worker. There is no place that shows the floor at once.

Team lists every worker as a card, including idle and paused ones, with no streaming output. Runs is a historical timeline. The board's In-progress column names who is live but does not stream. Watching several workers means opening several tabs.

## What Changes

- **A dedicated Live page** at `/w/:ws/live`. It is a workspace section, not a filter on Team or Board: one cell per currently-working worker in that workspace, each showing the worker's role name, the ticket identifier and title, and that worker's live output as it streams.
- **The working set is the existing live-vs-paused split.** A cell is a worker whose status is `provisioning`, `active` or `running` and who holds a ticket — the same `isLiveWorker` / `liveWorkersByTicket` the board already uses. Paused, idle, error, done and retired workers are not mixed in. A worker that leaves the live set (pause, finish, retire) drops off the grid without a reload; a worker that joins appears the same way. The membership itself is driven by the workspace event stream (`worker.spawned` / `worker.status` / `worker.retired` / `run.started` / `run.finished` already invalidate `qk.workers`).
- **Each cell streams through the existing run-event stream.** The cell opens `useRunEventStream` against the worker's current in-progress run and renders with `RunTranscript` (`live: true`). No new daemon route, no new event type, no new output channel. A cell whose worker is live but between turns (no in-progress run yet) still occupies the grid and says so, rather than looking empty or disappearing.
- **The cell is a link, not a control surface.** Activating the ticket identifier/title opens that ticket; activating the cell's body (or an explicit "open ticket" affordance) does the same. Steering, attaching, resume and cancel stay on the ticket and worker pages. Out of scope, as the ticket says.
- **Empty, loading and error states are designed.** No live workers → a worded empty state, not a blank grid. The workers query still loading → skeletons. The query failed → `ErrorState` with retry. The page does not fall back to paused or historical workers to fill the empty look.
- **The page is a rail destination.** It joins the desktop rail between Board and Team (`4`, Team through Settings shift one number), so it is reachable from the workspace chrome the way Chat, Board and Team already are. On a phone it is not a sixth tab — six still do not fit at 390 px — so it is listed in the More menu with the other destinations the five tabs leave out. PLAN §21.1's eight-item rail becomes nine; the phone bar stays five tabs.

## Capabilities

### New Capabilities

- `workspace-navigation/live-floor`: the Live page itself — who is on it, what a cell shows, how the grid updates, the empty/loading/error states, and that a cell is a link not a control surface.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: an expanded workspace group lists Live among its sections, in rail order, and the phone's More menu lists Live among the destinations the five tabs leave out. The requirement that names the eight sections is reworded to include Live; scenario names are kept.

## Impact

- `packages/ui/src/app/nav.ts` — `RAIL` gains Live (`kbd: '4'`); Team–Settings shift `5`–`8` / `,`; `MORE_ITEMS` gains Live so the phone can reach it; glyph set if a dedicated one is needed.
- `packages/ui/src/router.tsx` — `/w/$ws/live` registered.
- `packages/ui/src/routes/Live.tsx` (new) — the page: live-worker membership, grid, empty/loading/error.
- `packages/ui/src/components/LiveCell.tsx` (or equivalent) — one cell: role, ticket, `RunTranscript`.
- `packages/ui/src/lib/board.ts` — reuse `isLiveWorker`; a small `liveWorkingAgents(workers)` (or equivalent) that returns the live-and-on-a-ticket set as a list for the grid, rather than the ticket-keyed map the board uses.
- `packages/ui/src/app/WorkspaceNav.tsx`, `MoreSheet.tsx`, `AppShell.tsx` — consume `RAIL` / `MORE_ITEMS` as they already do; tests that pin "eight sections" and More leftovers update.
- `packages/ui/src/test/liveFloor.test.tsx` (new), `workspacenav.test.tsx`, `moreSheet.test.tsx`, `router.test.tsx` — membership, streaming, empty, nav.
- `docs/PLAN.md` §21.1 — Live in the rail.

No daemon, schema, event or API change. `GET /workers` and `GET /runs/:id/events/stream` already serve what the page needs; ticket identifier/title come from `GET /tickets` (already on the board) or a per-worker join the page already has via `useTickets` / `useRoles`.

## Out of scope

- Historical or completed workers, and paused workers on this page (they stay on Team / the board's paused badge).
- Cross-workspace aggregation.
- Editing, steering, attaching, resume or cancel from a cell.
- Changing how workers run, or adding a new output channel / SSE type.
- The TUI (`conductor top` already exists and is a different surface).
- The conductor's own turn — this page is workers on tickets; the conductor is watched from Chat.
