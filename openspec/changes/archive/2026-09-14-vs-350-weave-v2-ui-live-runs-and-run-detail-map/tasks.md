## 1. Shared building blocks

- [x] 1.1 Add an optional `bodyHeight?: number` prop to `packages/ui/src/v2/WorkerFeed.tsx` (default
  keeps today's 420, and 132 when `compact`), so a Live cell can set the 420/300/240/200 ladder
  without a second run stream. Verify with a `v2feed` test that the prop sets the feed body's height
  and that omitting it is unchanged.
- [x] 1.2 Add `useRunPagesMany(ids, params)` to `packages/ui/src/api/hooks.ts`: one query per
  workspace on the existing `qk.runs` key returning `{ runs, total }` from the server's
  `{ items, total }`. Verify with a test that it returns each workspace's runs and total and reuses
  the query key `useRunsMany` uses.
- [x] 1.3 Add `packages/ui/src/v2/map/model.ts` with `buildWorkerMapModel(workspaces)` returning the
  shared `MapModel` shape — workspace, project and worker nodes, with workspace→project and
  project→worker edges — and widen `MapNodeKind` in `packages/ui/src/lib/map/model.ts` with `worker`
  plus an optional `workerStatus`. Add the unreachable `worker` entries to `MapCanvas`'s kind records.
  Verify with a `mapWorkerModel` test that a worker lands under its project with a `runs in` edge and
  that V1's `mapModel` tests still pass.
- [x] 1.4 Add the Live per-row preference to `packages/ui/src/v2/prefs.ts` (a v2-namespaced key,
  clamped 1–4, default 2). Verify with a test that a written value reads back and an absent or
  out-of-range value yields the default.

## 2. Live at `/v2/live`

- [x] 2.1 Build `packages/ui/src/v2/LivePage.tsx`: fan out `useWorkersMany`, render one card per
  live worker (`liveWorkingAgents`, running first via `lib/liveOrder`) through the shared
  `WorkerFeed`, with real scope chips (`Everywhere` then each workspace) and a header stating the
  roster and shown counts from the same worker array. Verify with a `v2live` test that workers from
  two workspaces render, the weaver is excluded, a scope chip filters, and the header's shown figure
  equals the rendered card count.
- [x] 2.2 Add the desktop `−/+` per-row control clamped to 1–4, the 420/300/240/200 feed-height
  ladder, phone always one column with no control, and persistence through the task 1.4 pref. Verify
  with a test that stepping the control changes the grid's column count and the card's feed height,
  that phone renders one column, and that the choice is read back on mount.
- [x] 2.3 Give the card its V2 anatomy: header shows the resolved model (the run's `model` labelled
  through `useRuntimeModels` for the runtimes present, else the id), the ticket line shows the worker
  option name (`workerModelTagLabel`), the status is a word in the state hue, and no status glyph is
  rendered. Verify with a test that the header names the model, the ticket line carries the option
  name, and no status glyph element is present.
- [x] 2.4 Read a `worker` query parameter on Live: add a `validateSearch` passthrough to the V2 live
  route in `packages/ui/src/router.tsx`, apply that worker's workspace scope, and scroll to and mark
  its card. Verify with a test that opening Live naming a worker selects its workspace and marks the
  card.
- [x] 2.5 Replace the `V2LivePage` placeholder in `packages/ui/src/v2/pages.tsx` with the real screen
  and confirm VS-343's navigation tests still pass.

## 3. Runs and run detail

- [x] 3.1 Build `packages/ui/src/v2/RunsPage.tsx`: fan out `useRunPagesMany` across workspaces, merge
  the pages by `createdAt` descending, render the state chips (`all · queued · running · succeeded ·
  failed · timed_out · cancelled · interrupted`) as a query parameter, and add a load-more that
  raises `pageSize` and appends older turns. Verify with a `v2runs` test that two workspaces' turns
  merge newest-first, a state chip filters, load-more appends without dropping shown rows, and the
  rows' count matches any figure shown.
- [x] 3.2 Render the dense table (status with glyph · agent · model · turn ended · tokens · cost ·
  duration · when) with agent and model taking the width, and the phone card variant. Verify with a
  test that the desktop columns render and that a narrow render shows cards, and that a row opens the
  run detail.
- [x] 3.3 Build `packages/ui/src/v2/RunPage.tsx`: `useRun` for state/agent/model/timing/cost and
  `useRunEventStream` for the trace, a metadata table (agent, model, started, duration, tokens with
  context, cost, trigger), the full trace through `RunTranscript`, and the run's own `summary` as the
  plain-language ending. Derive the trigger from `retryOfRunId` / `wakeupIds` and never invent one.
  Verify with a test that a finished run shows its state, metadata and summary; a retried run names
  the retry; and a run with no resolvable wake says so.
- [x] 3.4 Replace the `V2RunsPage` and `V2RunPage` placeholders in `packages/ui/src/v2/pages.tsx`
  with the real screens.

## 4. Map at `/v2/map`

- [x] 4.1 Build `packages/ui/src/v2/MapPage.tsx` and its canvas component: fan out `useWorkspaces`,
  `useWorkspaceProjects` and `useWorkersMany`, build the graph with `buildWorkerMapModel`, lay it out
  with `layoutRadial`/`minSiblingGapByDepth`/`declutterLabels`/`driftOffset` and `lib/graph/viewport`,
  and restyle the nodes in Mono. Verify with a `v2map` test that two workspaces' nodes and edges
  render and that the canvas mounts.
- [x] 4.2 Add the filters (`Everywhere · each workspace · Attention`, where Attention is workers whose
  status is `paused` or `error`) and the legend derived from the statuses present. Verify with a test
  that a workspace filter prunes the graph, Attention keeps only the non-healthy workers with their
  parents, and the legend names only present statuses.
- [x] 4.3 Wire node routing — worker → `/v2/live?worker=<agentId>`, project →
  `/v2/w/<ws>/work?project=<slug>`, workspace → `/v2/w/<ws>/chat` — and add a footer stating what is
  shown, worded distinctly from the header. Verify with a test that activating each kind navigates to
  its target and that the footer copy differs from the header's.
- [x] 4.4 Replace the `V2MapPage` placeholder in `packages/ui/src/v2/pages.tsx` with the real screen.

## 5. Incidents at `/v2/incidents`

- [x] 5.1 Build `packages/ui/src/v2/IncidentsPage.tsx`: `useIncidents()` for the daemon-wide list,
  `All · Open · Resolved` chips filtering on `resolvedAt`, cards with a dot pulsing while open, the
  title and a state · time · scope line, and expansion showing what failed, the `evidence` block and
  the weaver-handles note. Verify with a `v2incidents` test that each chip filters, an open card
  pulses and a resolved one does not, expansion shows the evidence, and no Retry/Resolve control or
  error code is rendered.
- [x] 5.2 Replace the `V2IncidentsPage` placeholder in `packages/ui/src/v2/pages.tsx` with the real
  screen.

## 6. The worker page

- [x] 6.1 Build `packages/ui/src/v2/WorkerPage.tsx` on `V2Page`: `useWorker` for identity, status,
  project/ticket/usage metadata, a not-found state, a ticket link, and Transcript/Brief tabs with the
  brief through `Markdown`. Verify with a `v2worker` test that identity and metadata render, the brief
  tab renders the brief, an unknown worker shows the not-found state, and the ticket link is present.
- [x] 6.2 Render the Transcript tab through the shared `WorkerFeed` (following the current turn,
  keeping the last turn between turns) and wire the header actions (`Resume`, `Session` /
  `Give it back`, `Relaunch`, `Cancel`) through `useWorkerAction`. Verify with a test that a paused
  worker offers Resume and that a running worker renders the shared feed.
- [x] 6.3 Reuse the session-handover band (`useHandoverCommand`, `useStartHandover`, `useEndHandover`)
  and the steer composer (`useWorkerMessage` with the shared ticket draft, reporting
  mid-turn/interrupted/queued). Verify with a test that giving a held session back posts the note, and
  that a steer send posts to the ticket and reports the delivery outcome.
- [x] 6.4 Replace the `V2WorkerPage` placeholder in `packages/ui/src/v2/pages.tsx` with the real
  screen.

## 7. Verification

- [x] 7.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 7.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.
- [x] 7.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed, and
  that V1 at `/` and its tests are untouched.
- [x] 7.4 Run `openspec validate vs-350-weave-v2-ui-live-runs-and-run-detail-map --json --strict` and
  confirm it is clean.
- [x] 7.5 Treat the acceptance list as the exit criteria: each screen shows real cross-workspace data
  with working filters and matching counts; Live's per-row control changes layout and feed height;
  Runs lists every workspace's runs and opens run detail; Map nodes route correctly; Incidents expand
  with no action buttons; and the covering tests pass.

## 8. Review fixes (PR #299)

- [x] 8.1 Map → Work carries the project **id**, not the slug, so the Work project filter
  (`filterTickets`: `t.projectId === f.project`) keeps that project's tickets. Verified by the map
  routing test asserting the Work target's `project` search is the project id.
- [x] 8.2 Live applies the `?worker=` focus scope **once**, so the scope chips work afterwards
  instead of being undone on every render. Verified by a test that arrives focused and then changes
  scope with a chip.
- [x] 8.3 The worker page surfaces each action mutation's error (Resume/Relaunch/Cancel and Take this
  session) and puts Cancel behind a confirmation step. Verified by tests for a shown error and for
  Cancel requiring confirmation.
- [x] 8.4 The V2 Map pans by drag and zooms by wheel through `lib/graph/viewport` (plus fit), so a
  zoomed-in graph is navigable. Verified by a drag test asserting the transform group moves.
- [x] 8.5 Replaced the undefined `rounded-r5` in `LiveCard` with `rounded-r4`.
