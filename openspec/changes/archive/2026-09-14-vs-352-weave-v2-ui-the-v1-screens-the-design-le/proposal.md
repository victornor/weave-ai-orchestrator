## Why

V2 (`/v2`, VS-343) ships the shell and an addressable placeholder for every destination; VS-349 added
the V2 Chat screen and VS-347 the knowledge views. Captain decided on 2026-09-13 that V2 keeps the V1
screens the design leaves out, restyled so they match V2 entirely — "we need to make sure that we take
the V1 pages and we implement them in the V2 so the style matches." Four of those kept screens are
still bare `V2Page` placeholders: Global Chats (`/v2/chats`), the project overview
(`/v2/w/:ws/p/:project`), Usage (`/v2/w/:ws/usage`) and Changelog (`/v2/w/:ws/changelog`). Until they
are built, the V2 rail's More list and the project rows reach empty shells.

## What Changes

- **Global Chats at `/v2/chats`.** The V1 multi-pane behaviour (VS-336) is kept: one pane per
  workspace, resized by dragging the separator, collapsed to a sliver with the arrow pointing right
  (VS-341), and reordered by drag or the header menu, with the layout remembered on the device. Each
  pane is VS-349's `V2ChatPage` for its workspace, exactly one pane holding the live event
  subscription and run stream (VS-199), and the pane chrome, separators and slivers are V2's.
  `V2ChatPage` gains an optional `focused` prop (defaulting to true) so the pane that is not focused
  gates its run stream and any per-pane shortcut, exactly as V1's `ChatPage focused` does.
- **Project overview at `/v2/w/:ws/p/:project`.** The V1 sections are kept and restyled to V2:
  About (git URL, default branch, delivery mode, sync state, current focus), History (the commit graph
  and lane drawing), Pull requests (list, detail and the shared diff renderer with VS-344's layout
  fix), Recent landings, Activity, Needs you, Work under way and Knowledge. The header carries V2's
  own links (Work, Knowledge, Chat), with the merge-queue link dropped because V2 has no merge-queue
  route and the Specs link dropped because V2 has no specs route (specs are browsed in Knowledge).
- **Usage at `/v2/w/:ws/usage`.** V1's windows and grain picker, the credentials panel, the knowledge
  context section, the headline stat tiles, the plan limits, the by-project stacked bars, the top
  tickets/roles/workers breakdowns, the runs series, the model mix and the project share are kept and
  restyled into the V2 page frame and cards.
- **Changelog at `/v2/w/:ws/changelog`.** V1's content is kept: the year heatmap over a newest-first
  timeline grouped by day, week and month, with the same kind vocabulary and ticket links, restyled.
- **A small shared extension to the V2 page frame.** `V2Page` gains an optional header `actions` slot
  so Usage (window/grain), Changelog and the project overview can put their controls in the 38px
  header the way V1 does, without each screen re-implementing the breadcrumb.
- **Frontend only.** No daemon, API or migration change. Data comes from the existing
  `packages/ui/src/api/**` hooks, `@weave-ai/shared` and `@weave-ai/render` helpers, and V1's pure view
  models (`lib/globalChatLayout`, `lib/projectOverview`, `lib/board`, `lib/commitGraph`). V1 at `/` is
  untouched.

## Capabilities

### New Capabilities

- `web-v2/global-chats`: the V2 Global Chats screen — one pane per workspace, each running the V2 Chat
  screen, with resizable separators, collapse-to-sliver and reorder, and a layout remembered on the
  device.
- `web-v2/project-overview`: the V2 project overview — the kept V1 sections (history graph, pull
  requests with diffs, landings, activity, needs you, work, knowledge) restyled into V2's frame and
  primitives.
- `web-v2/usage`: the V2 Usage screen — the window/grain picker, credentials, knowledge context,
  headline tiles, plan limits and the token/cost/model/project breakdowns, restyled.
- `web-v2/changelog`: the V2 Changelog screen — the year heatmap and the day/week/month timeline of
  the workspace record, restyled.

### Modified Capabilities

- `web-v2/shell`: the page frame's header accepts an optional screen-supplied `actions` slot, so a
  destination can put its own controls in the 38px header while keeping the shared breadcrumb, label
  and one-source counts.

## Impact

- **New:** `packages/ui/src/v2/chats/ChatsPage.tsx` (the multi-pane screen and its page chrome),
  `packages/ui/src/v2/project/ProjectPage.tsx` and its section components,
  `packages/ui/src/v2/usage/UsagePage.tsx`, `packages/ui/src/v2/changelog/ChangelogPage.tsx`, and new
  UI tests under `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` (the four placeholders become the real screens),
  `packages/ui/src/v2/V2Page.tsx` (the optional header `actions` slot),
  `packages/ui/src/lib/globalChatLayout.ts` (an optional storage-key argument so V2 remembers its own
  layout without reading or writing V1's `conductor.globalChats.layout`), and
  `packages/ui/src/v2/v2.css` if a screen needs a V2 recipe not yet in the shared CSS.
- **Reused, not forked:** `packages/ui/src/api/**` (`useWorkspaces`, `useProjects`, `useProjectHistory`,
  `usePullRequests`, `usePullRequest`, `usePullRequestDiffFiles`/`File`/`Context`, `useChangelog*`,
  `useDecisions`, `useTickets`, `useWorkers`, `useRuns`, `useUsage*`, `useKnowledgeUsage*`,
  `useUsageAccounts`, `useUsageCredentials`, `useMergeQueue`, `useKnowledgeDoc`/`Docs`/`Health`),
  `lib/globalChatLayout`, `lib/projectOverview`, `lib/board`, `lib/commitGraph`, `lib/diffLayout`,
  `lib/highlight`, `@weave-ai/render` (`groupTimeline`, `seriesColor`, `accountLimits`, `showCost`,
  `mixedBillingNote`, `workerPauseReason`), the token-driven primitives `components/Chart`,
  `components/WindowGrainPicker`, `components/PlanLimits`, `components/RuntimeCredentials`,
  `components/Heatmap`, `components/DiffHunks`, and `KIND_LABEL`/`KIND_TONE` from `routes/Changelog`.
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
