## Why

V2's shell and theme (VS-343) and the shared worker live feed (VS-345) are in place, but the
observability screens are still placeholders. Captain's redesign defines them at HANDOFF.md **§8
Live**, **§11 Incidents**, **§12 Runs** and **§13 Map**, with §15's one-source-count and scope rules
applying to all of them. They are one ticket because they share the same cross-workspace fan-out
(the API is per workspace), the same run-event feed, and the same table/card idioms — building them
apart would fork each.

## What Changes

- **Live at `/v2/live`**: a cross-workspace grid of live-worker cards, two per row on desktop with a
  `−/+` control for one to four per row and a feed height that scales inversely (420 / 300 / 240 /
  200px), one column on phone. Real scope chips and a header that states the roster and what is shown
  (`6 running · showing 2`). The card header shows the resolved model; the option name moves to the
  ticket line; no status glyph (the status word carries the hue). Feeds hold real scrollback, keep
  authored indentation and hang wrapped lines. V1 behaviours the design does not contradict are kept:
  edit diffs, the last turn held between turns, running workers listed first.
- **Runs at `/v2/runs`**: a dense cross-workspace table — status with glyph, agent, model, turn
  ended, tokens, cost, duration, when — fanned out across workspaces with the per-workspace page
  merged by recency and a load-more control. State chips `all · queued · running · succeeded ·
  failed · timed_out · cancelled · interrupted` filter for real. Agent and model get the width;
  phone collapses each run to a card.
- **Run detail at `/v2/runs/$runId`**: state and turn outcome, a metadata table (agent, model,
  started, duration, tokens with context, cost, trigger), the full tool trace, and a plain-language
  account of how the turn ended.
- **Map at `/v2/map`**: a workspace → project → worker graph with `runs in` edges, reusing V1's map
  geometry and interaction logic but restyled. Filters `Everywhere · each workspace · Attention`
  prune the graph; the legend derives from the statuses actually present; nodes route by kind (a
  worker opens Live, a project opens Work, a workspace opens Chat); a footer reports what is shown,
  phrased distinctly from the header.
- **Incidents at `/v2/incidents`**: one flat list with `All · Open · Resolved` chips; cards with a
  status dot (pulsing while open), title, and a state · time · scope line; expanding shows what
  failed, the `evidence` log block, and the note that the weaver handles it. No Retry or Resolve
  controls, and no error-code field.
- **The worker page** at its VS-343 route: V1's `WorkerPage` restyled to V2 — transcript and brief,
  the header actions, the session-handover band and the steer composer, over the shared live feed.
- **Frontend only.** No daemon, HTTP, MCP, CLI or migration change. Data comes from the existing
  `packages/ui/src/api/**` hooks and `@weave-ai/shared`. V1 at `/` is untouched.

## Capabilities

### New Capabilities

- `web-v2/live`: the global V2 Live floor — its grid, per-row density control, scope chips and
  one-source roster/shown counts, and the card anatomy of resolved model, option name and status.
- `web-v2/runs`: the global V2 Runs table and run detail — the cross-workspace fan-out and merge with
  load-more, the state filter, the dense columns and phone cards, and the run-detail metadata,
  tool trace and turn outcome.
- `web-v2/map`: the global V2 Map — the workspace → project → worker graph with `runs in` edges, its
  scope and Attention filters, its derived legend, its node routing, and its distinct footer.
- `web-v2/incidents`: the global V2 Incidents list — the `All · Open · Resolved` filter, the card
  anatomy and expansion, and the absence of action controls.
- `web-v2/worker-page`: the restyled V2 worker page — its transcript and brief, header actions,
  session-handover band and steer composer.

### Modified Capabilities

_None. V2 is additive; the VS-343 shell and VS-345 feed keep their behaviour and V1 is unchanged._

## Impact

- **New:** `packages/ui/src/v2/LivePage.tsx`, `packages/ui/src/v2/RunsPage.tsx`,
  `packages/ui/src/v2/RunPage.tsx`, `packages/ui/src/v2/MapPage.tsx`,
  `packages/ui/src/v2/IncidentsPage.tsx`, `packages/ui/src/v2/WorkerPage.tsx`, plus their
  sub-components and any map-model helper they need. New UI tests under `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` (the five placeholders become the real screens);
  `packages/ui/src/v2/prefs.ts` (remember the Live per-row choice); `packages/ui/src/router.tsx`
  (a `validateSearch` passthrough on the V2 live route, so a Map worker node can open Live focused on
  that worker). `packages/ui/src/api/hooks.ts` gains one fan-out hook that keeps each workspace's
  page total, if the existing hooks cannot express load-more for Runs.
- **Reused, not forked:** `packages/ui/src/api/**` (`useWorkersMany`, `useRunsMany`, `useRun`,
  `useRunEventStream`, `useIncidents`, `useWorkspaces`, `useWorkspaceProjects`, `useModelsMany`),
  `lib/board` (`liveWorkingAgents`, `isLiveWorker`), `lib/liveOrder`, `lib/liveCellSize`,
  `lib/map/*` (`buildMapModel`, `layoutRadial`, `declutterLabels`, `beams`, `drift`),
  `lib/graph/viewport`, `components/RunTranscript`, `components/Markdown`, and VS-345's
  `v2/WorkerFeed`.
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
