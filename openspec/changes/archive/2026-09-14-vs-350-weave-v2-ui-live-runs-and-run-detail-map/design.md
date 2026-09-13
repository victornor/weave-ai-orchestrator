## Context

See `proposal.md` — Why. V2 (VS-343) is a parallel frontend under `packages/ui/src/v2/`, lazily
mounted at `/v2` in `packages/ui/src/router.tsx`, with the Mono tokens scoped to `.v2-root`
(`v2/v2.css`), a destination registry in `v2/nav.ts`, a page frame in `v2/V2Page.tsx`, `prefs.ts`
for device-remembered state, and placeholder page components in `v2/pages.tsx`. VS-345 added the
shared worker feed (`v2/WorkerFeed.tsx`).

The data these screens need already exists in V1 and is reused, not forked:

- `api/hooks.ts`: `useWorkers`/`useWorkersMany`, `useRuns`/`useRunsMany` (per workspace; the server's
  paged shape carries `{ items, total }`), `useRun` (`RunDetail`), `useIncidents` (daemon-wide),
  `useWorkspaces`, `useWorkspaceProjects`, `useProjects`, `useModelsMany`, `useRuntimeModels`,
  `useWorker`, `useWorkerBrief`, `useWorkerAction`, `useWorkerMessage`, `useRunEvents`.
- `api/runStream.ts`: `useRunEventStream(runId, { live, newest, ws })`.
- `lib/board.ts` (`liveWorkingAgents`, `isLiveWorker`), `lib/liveOrder.ts` (running-first with a
  grace window), `lib/liveCellSize.ts` (the size ladder), `lib/format.ts`.
- `lib/map/model.ts` (`MapModel`, `MapNode`, `MapNodeKind`), `lib/map/radial.ts`
  (`layoutRadial`, `minSiblingGapByDepth`), `lib/map/labels.ts` (`declutterLabels`),
  `lib/map/drift.ts` (`driftOffset`), `lib/graph/viewport.ts` (zoom/pan/fit).
- `components/RunTranscript.tsx` (edit diffs, indentation, stick-to-bottom), `components/Markdown.tsx`,
  `components/Composer.tsx`, `components/HandoverCommand.tsx`, `v2/WorkerFeed.tsx`.

V1's GlobalLive/GlobalMap/GlobalIncidents/WorkerPage implement the behaviour for V1's visual
language; V2 must not change V1 at `/`, so V2 gets its own components that reuse these hooks and pure
helpers.

## Goals / Non-Goals

**Goals:**

- The five screens at their VS-343 routes, each showing real cross-workspace data, filterable, with
  the counts a screen shows derived from the list it renders.
- One cross-workspace runs fan-out with a load-more, shared by the Runs table and the run detail's
  data source.
- The map reuses V1's layout and interaction logic, restyled, with V2 node semantics.

**Non-Goals:**

- Any daemon, HTTP, MCP, CLI or migration change; any change to V1 at `/`.
- The content of Work, Chat, Roles, Settings, Knowledge, Usage or Changelog.
- The trigger's plain-language wake *reason*: the run record exposes wake ids but no session endpoint
  returns a wake row, and the ticket forbids a new endpoint. See Decisions.

## Decisions

### Each screen is a V2 module; the placeholder is replaced in `v2/pages.tsx`

`V2LivePage`, `V2RunsPage`, `V2RunPage`, `V2MapPage`, `V2IncidentsPage` and `V2WorkerPage` in
`v2/pages.tsx` become thin re-exports of real modules (`v2/LivePage.tsx`, `v2/RunsPage.tsx`,
`v2/RunPage.tsx`, `v2/MapPage.tsx`, `v2/IncidentsPage.tsx`, `v2/WorkerPage.tsx`), each rendering
`V2Page` with its body. V1's routes, components and tests are untouched.

_Alternative considered:_ render V1's `GlobalLive`/`GlobalMap` inside the V2 frame. Rejected — V1's
components carry V1's table/card idioms (pills, status glyphs, opacity dimming) that the Mono design
explicitly replaces, and VS-343's isolation rule wants V2's visuals in V2 modules.

### Live cells reuse the VS-345 feed, with one additive prop for the height ladder

`v2/WorkerFeed.tsx` currently hardcodes `maxHeight: compact ? 132 : 420`. Live needs 420 / 300 / 240 /
200 for one to four per row, so the feed gains an optional `bodyHeight?: number` prop (default
unchanged). The Live card composes the feed with the model/option/status header; it does not open a
second run stream. `lib/liveOrder.ts` and `lib/board.ts` give the running-first order and the live
roster, `lib/liveCellSize.ts` the ladder.

_Alternative considered:_ Live builds its own feed with `useRunEventStream`. Rejected — that is the
duplication VS-345 exists to prevent.

### Cross-workspace Runs: fan out with each workspace's page total, merge by recency

`GET /api/w/:ws/runs` already returns `{ items, total }`, but `useRunsMany` maps it to `Run[]` and
drops the total. Runs needs a real load-more, so a new hook `useRunPagesMany(ids, params)` returns one
`{ runs, total }` query per workspace (same `qk.runs` key). The screen keeps a `pageSize` (starts at
50), fetches `limit: pageSize` per workspace, merges all items sorted by `createdAt` descending, and
computes `hasMore` from the summed workspace totals against the merged length; load-more raises
`pageSize`. State filtering is a query parameter so each workspace's total reflects the filter.

_Alternative considered:_ reuse `useRunsMany` and treat `items.length === limit` as hasMore.
Rejected — with several workspaces it makes load-more exact only by luck, and it reads a total the
server already sends.

### Run detail's trigger is derived from the run's own signals, honestly

The run row carries `wakeupIds` (ids only) and `retryOfRunId`; no session endpoint returns a wake row,
and the ticket forbids a new one. The trigger cell is therefore derived from what the run records:
a `retryOfRunId` reads as the retry it is, a run with `wakeupIds` reads as started by a wake, and a
run with neither states that plainly. The screen never invents a reason it cannot read. The "how it
ended" account is the run's own `summary`, and the tool trace is `useRunEventStream` rendered through
`RunTranscript`, so a running detail follows the turn and a finished one stays still.

_Alternative considered:_ add the wakes to `GET /runs/:id`. Rejected — an endpoint change is out of
scope for this ticket. Recorded here so the plan review can revisit it.

### The map gets a V2 worker model, and reuses the shared layout and interaction modules

V1's `buildMapModel` builds role/ticket/knowledge nodes for a ticket-centric graph; the design is a
workspace → project → worker graph whose worker nodes open Live. V2 therefore adds
`v2/map/model.ts` with `buildWorkerMapModel` (workspace, project and worker nodes; workspace→project
and project→worker edges) returning the shared `MapModel` shape, and `lib/map/model.ts`'s
`MapNodeKind` gains `'worker'` with an optional `workerStatus`. The pure modules (`layoutRadial`,
`minSiblingGapByDepth`, `declutterLabels`, `driftOffset`, `lib/graph/viewport`) are reused unchanged;
V1's `MapCanvas` kind maps gain an unreachable `worker` entry so the exhaustive records still
compile. V2 does not use `beamsFor` — it is ticket-keyed and there are no ticket nodes here.

_Alternative considered:_ reuse V1's `buildMapModel` verbatim. Rejected — its nodes are roles,
tickets and knowledge, so "a worker opens Live" and the Attention filter would not be expressible.

### Map filters: Attention is the non-healthy workers

`Everywhere` and each workspace filter by `workspaceId`. `Attention` prunes to workers whose agent
status is `paused` or `error`, kept with their owning project and workspace. The legend is built from
the worker statuses actually present. Node routing: worker → `/v2/live?worker=<agentId>`,
project → `/v2/w/<ws>/work?project=<slug>`, workspace → `/v2/w/<ws>/chat`. The footer states the
counts of what is shown, worded distinctly from the header's roster (HANDOFF §15).

### Live focus uses a `worker` query parameter on the V2 live route

The V2 live route gains a `validateSearch` passthrough (like the V1 global routes), and Live reads
`?worker=`. When set, Live applies that worker's workspace scope and scrolls to and marks its card.
This is what makes the map's "a worker opens Live" meaningful.

### The worker page reuses hooks and the shared feed, restyled at the frame

`v2/WorkerPage.tsx` reuses `useWorker`, `useWorkerBrief`, `useWorkerAction`, `useWorkerMessage`,
`useHandoverCommand`, `useStartHandover`/`useEndHandover` and the draft-sharing helpers exactly as V1's
`WorkerRoute` does, renders the Transcript through the shared `WorkerFeed` (not a private stream), the
Brief through `Markdown`, and the session band and steer composer with V2-styled controls. V1's
presentational `Composer`/`Markdown` are legitimate to reuse because they render off the same CSS
variables the `.v2-root` scope overrides; the V2 page supplies the anatomy around them.

## Risks / Trade-offs

- **[The trigger is coarser than the mockup's plain-language reason]** → Documented above and in the
  spec; the screen states what it can read and the plan review can add the endpoint later.
- **[Extending `WorkerFeed` touches VS-345's shared component]** → The new `bodyHeight` prop defaults
  to today's value, so V2's other consumers (the decision card, future Roles) are unaffected; the
  VS-345 feed tests keep passing.
- **[Widening `MapNodeKind` touches a V1 lib and `MapCanvas`]** → The new kind is never emitted by V1's
  builder, so V1 renders no new node; the change is a type widening plus unreachable record entries.
  V1's map tests must still pass.
- **[The Runs load-more refetches every workspace as `pageSize` grows]** → Bounded by the page ladder
  and acceptable for a UI list; the server caps `limit`, and the merge is pure and cheap.
- **[Live per-row, feed height and grid columns cannot be measured in jsdom]** → Test the pure ladder
  (`lib/liveCellSize`-style mapping and the column/height table) and the rendered control's effect on
  the grid style, not pixel geometry (the repo's jsdom convention).
- **[Runs and Incidents have no server cursor]** → Runs uses per-workspace `limit`/`offset` with the
  server's `total`; Incidents is bounded by the daemon's default window and filters client-side, as
  V1's page does.
- **[The worker page restyle is the largest surface]** → It reuses every hook and the shared feed, so
  the new code is the frame and styling; behaviour is pinned by tests mirroring V1's worker-page tests.

## Migration Plan

Frontend-only and additive. No data migration, no deploy step beyond the daemon's normal UI build.
Rollback is reverting the V2 modules; V1 is unaffected either way.

## Open Questions

_None that change the specs, approach or task breakdown._
