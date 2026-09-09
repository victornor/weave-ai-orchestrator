## Context

See `proposal.md`. What matters for the design:

- Live membership already exists: `isLiveWorker` is `status ∈ {provisioning, active, running}` (`packages/ui/src/lib/board.ts:41-45`). `liveWorkersByTicket` additionally requires `ticketId` and keeps the newest worker per ticket. The Live page wants the workers themselves, not a ticket-keyed map, but the predicate is the same.
- Output already streams: `useRunEventStream(runId, { live })` (`packages/ui/src/api/runStream.ts`) plus `RunTranscript` (`packages/ui/src/components/RunTranscript.tsx`). Ticket page and Run page already use both. WorkerPage still tails via `useWorkspaceEvents` + `run.event` frames — the Live page uses the per-run stream, not that older path, because VS-59 made the per-run stream the one that reconnects with `?after=` and reports `live-streams/connection-state`.
- A live worker's current run is not on the `GET /workers` list item (`WorkerListItem` is `Agent & { interactiveSession }`). `GET /workers/:id` carries `lastRun`. Opening N detail queries on the floor is wasteful; `GET /runs?status=running` (and `queued`) already exists (`docs/API.md`, `useRuns`) and `Run.agentId` joins to the worker. `run.started` / `run.finished` already invalidate `qk.runs` and `qk.workers`.
- Role name vs agent name: `Agent.name` is already `"Frontend Engineer #7"` — the role name plus the instance number (`packages/ui/src/test/factories.ts`). The ticket says "role name"; showing `agent.name` is that, and a lookup through `useRoles` for the hired role's `name` is the same string without the number. Show `agent.name` (identifies which instance when a role has several live workers) plus the ticket identifier/title.
- Rail vs More: DESIGN-CONTRACT / PLAN §21.1 fix the rail at eight entries with `1`–`7` and `,`, and the phone at five tabs because six do not fit at 390 px. VS-58 kept merge-queue off the rail because it is empty most of the time and has a door on the board. Live is the opposite: it is the "what is happening right now" view, empty only when the workspace is idle, and it has no existing door. Putting it only in More would hide it on desktop.

## Goals / Non-Goals

**Goals:**

- One addressable page per workspace that is the live floor, reachable from the chrome.
- Membership identical to the board's live set, so the floor and the In-progress column never disagree about who is working.
- Each cell streams the same transcript the ticket/run pages already stream, without a new channel.
- Empty is a designed state, not a grid of paused or historical workers.

**Non-Goals:**

- A new API, event, or run-output channel.
- Steering, attach, or any write from a cell.
- Showing the conductor.
- Cross-workspace, history, paused-on-this-page.

## Decisions

### D1. Rail destination, phone via More — not a Team tab, not board-only

The ticket says "reachable from the workspace chrome (nav or equivalent)". Options:

| Option | Verdict |
|---|---|
| A tab/filter on Team | Rejected. Team is the org view (roles, charters, idle and paused workers). Mixing a live floor into it either hides the org or makes the floor a filter the human has to remember to set. |
| A strip on the board linking to a hidden route (VS-58's merge-queue pattern) | Rejected as the only door. Live is something you open to watch, not something you notice while already on the board. A board strip could be a later extra, not this ticket. |
| Rail + More | Chosen. Desktop: ninth rail item, `Live`, between Board (`3`) and Team (now `5`). Phone: five tabs unchanged; Live joins `MORE_ITEMS` (the leftovers the bar does not carry). Keyboard numbers Team→Settings become `5` `6` `7` `8` `,`. |

PLAN §21.1 is updated to list Live. The sidebar-workspaces spec currently names the eight sections in order; that requirement is MODIFIED (scenario names kept, per the VS-89/rename landmine).

**Keyboard.** New `4` for Live. Existing muscle memory for Team/Runs/Usage/Knowledge shifts by one. Alternative of squeezing Live in without numbers (like merge-queue) was rejected because then it is not on the rail, which is the chrome the ticket asks for.

### D2. Membership is `isLiveWorker` ∩ has `ticketId`, listed as workers not tickets

Reuse `isLiveWorker`. Do not reuse `liveWorkersByTicket` as the grid source: that map is one-worker-per-ticket, which is almost always right, but the grid's unit is the worker. If two live workers ever share a ticket the floor shows both; the board still shows one. Filter: `kind === 'worker'` so the conductor never appears (it has no ticket anyway). Sort: newest `createdAt` first, stable by `id` — newest work at the top-left, no user-facing sort control in this ticket.

A live worker without a current in-progress run still occupies a cell (provisioning, or the gap between turns). The cell identifies the worker and ticket and says the turn has not started yet, rather than omitting the worker until `run.started`.

Paused workers are excluded by `isLiveWorker` already. Do not call `pausedWorkersByTicket` here.

### D3. Current run from `useRuns({ status: 'running' })` (plus `queued`), not N worker-detail fetches

`GET /runs?status=` already lists runs. The page fetches running (and queued) runs once, indexes by `agentId`, and each cell reads its agent's active run from that map. `run.started` / `run.finished` already invalidate `qk.runs`, so a turn starting or ending updates the map without a dedicated invalidation. `useRunEventStream(runId, { live: true })` is mounted only while that cell's run is in `ACTIVE_RUN_STATUSES`; when the run finishes the stream closes (`live: false` / `runId: null`) and the cell either waits for the next run or the worker drops off the live set.

Capping streams: a busy workspace can have a handful of live workers, not dozens. Each `useRunEventStream` is one SSE. No fan-out cap in this ticket; if a future workspace regularly has tens of concurrent workers that is a follow-up. Do not multiplex onto the workspace `run.event` frames — those are not the reconnectable per-run stream.

### D4. Cell chrome is identity + transcript; the ticket is the only link

Header: `agent.name` (role + instance), then the ticket identifier and title as a link to `/w/$ws/tickets/$ticketId`. Body: `RunTranscript` with `contained: true` already, so each cell scrolls itself and does not drag the page. A compact `max-h` smaller than the ticket page's half-viewport (a cell is one of many) — roughly a quarter of `--ac-app-h` on desktop, full-width stacked on phone.

No resume, pause, attach, composer, or steer box. Clicking the transcript area does not navigate (selecting/copying text must work); the ticket link in the header is the way in. Optional: the whole header is the hit target.

### D5. Layout

**Desktop (≥ md).** `PageHeader title="Live"` with `meta` = `"N working"` (or nothing when empty). Body: CSS grid, `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`, `gap-3`, `p-4 md:p-5`. Each cell is an `ac-card`. No virtualization in this ticket — the working set is small.

**Phone.** Same page, one column. Reached from More, so the More tab is marked active while Live is showing (More already does this for its destinations). Transcript `contained: true` so the page can still scroll past a cell (VS-130: do not put `.ac-scroll`'s `overscroll-behavior: contain` on a region that should yield to the page — `RunTranscript` already uses `.ac-scroll`; a cell that should let the page continue uses a bounded max-height so the page scroller owns the rest).

**Empty.** `EmptyState title="Nobody is working."` with a one-line detail pointing at Board / Team, no fake cells.

**Loading.** `SkeletonRows` (or a skeleton grid of cards) while `useWorkers` is pending. Gate on `data !== undefined`, not `!isLoading` (web-app-testing landmine).

**Error.** `ErrorState` with retry on the workers query. A failed runs query does not empty the grid: cells still show identity, and the transcript area of each cell says the stream could not load.

### D6. Ticket identity from `useTickets`, roles from `useRoles` if needed

`Agent.ticketId` is the ticket's id, not its identifier. The board already loads tickets (`useTickets({ limit: 300 })`) and looks up by id. The Live page does the same: join `ticketId` → `{ identifier, title }`. A ticket not in that page (rare: a live worker on a ticket outside the default list) falls back to showing the id until the ticket query includes it, or a follow-up fetch; do not block the cell on it.

`agent.name` is enough for "role name"; no extra role fetch required for the header. `useRoles` is available if a test wants the hired role's name without the `#N`.

### D7. No daemon change

Reconfirm: no new route, no new event, no `docs/API.md` addition. If apply discovers `GET /runs?status=running` is insufficient (e.g. it does not return `queued` alongside, or pagination hides a live run), join via `GET /workers/:id` for the cells that lack a run in the list — still no new endpoint. Do not add a "live floor" aggregate to the daemon in this ticket.

## Risks / Trade-offs

- [N concurrent `EventSource`s] → accepted for the current working-set size; revisit with a multiplexer if a workspace regularly exceeds ~10 live workers.
- [Keyboard-number shift on the rail] → accepted so Live is a first-class section; documented in PLAN §21.1. Merge-queue stays off the rail.
- [`GET /tickets` default list missing a live worker's ticket] → cell still renders with `agent.name` and a degraded ticket label; not a reason to add a new join endpoint.
- [WorkerPage's workspace-event tail vs per-run stream] → Live uses the per-run stream only; do not "fix" WorkerPage in this ticket.
