## 1. Shared building blocks

- [x] 1.1 Add an optional `actions?: ReactNode` to `V2Page` (`packages/ui/src/v2/V2Page.tsx`), rendered
  in the 38px header beside the label and counts without changing the breadcrumb, label or counts.
  Verify with a component test that supplying actions renders them in the header, that the label and
  counts still render, and that omitting actions renders the header as before.

- [x] 1.2 Give `readGlobalChatLayout` / `writeGlobalChatLayout` in
  `packages/ui/src/lib/globalChatLayout.ts` an optional storage-key argument defaulting to V1's
  `conductor.globalChats.layout`, and export V2's key from `packages/ui/src/v2/prefs.ts`. Verify with a
  unit test that V2's key is written and read independently of V1's, and that a parameterless call is
  unchanged.

## 2. Global Chats at `/v2/chats`

- [x] 2.1 Add an optional `focused?: boolean` (default `true`) to `V2ChatPage`
  (`packages/ui/src/v2/ChatPage.tsx`) and gate `useRunEventStream` with it (`live: focused && (live?.running ?? false)`),
  along with any per-pane global listener or keyboard shortcut, exactly as V1's `ChatPage focused` does
  (`routes/Chat.tsx:203, 427`); the standalone `/v2/w/$ws/chat` route passes nothing and is unchanged.
  Verify with a component test that two panes with both weavers running leave only the focused pane's
  run stream live, and that with no `focused` prop the stream behaves as before.

- [x] 2.2 Build `packages/ui/src/v2/chats/ChatsPage.tsx`: read `useWorkspaces`, reconcile the saved
  layout against the listed ids, and render one pane per workspace, each wrapping VS-349's
  `V2ChatPage focused={id === focused}` in `WorkspaceProvider ws={id} remember={false} live={id === focused}`;
  show the loading, empty and error states. Verify with a component test that one pane renders per
  workspace, each pane's chat is its own workspace's, and only the focused pane is live.

- [x] 2.3 Build the pane chrome: a 38px identity bar with the workspace name and its needs-you count, a
  collapse control whose arrow points right (VS-341), and a reorder menu (move left / move right),
  plus the drag separator between expanded panes and the sliver that expands on activation, all wired
  to the pure model (`setPairSplit`/`resetPair`, `toggleCollapsed`/`canCollapse`, `movePane`,
  `placePane`, `nearestExpanded`). Verify with a component test that collapsing makes a sliver and
  focusing moves to the nearest expanded pane, that the last expanded pane cannot collapse, and that
  move-left/right reorders.

- [x] 2.4 Persist the layout under V2's key and reconcile on load: order, per-pane width share and
  collapsed state survive a remount, a removed workspace is dropped, an added one is appended
  expanded, and V1's layout key is neither read nor written. Verify with a component test that a
  rearranged layout is restored after remount and that V1's stored layout is untouched.

## 3. Usage at `/v2/w/$ws/usage`

- [x] 3.1 Build `packages/ui/src/v2/usage/UsagePage.tsx` in the `V2Page` frame with the window/grain
  control (`WindowGrainPicker`) supplied as the header actions, the runtime credentials above the
  figures, the headline tiles (tokens, cost only when the window was billed per token, runs, cached
  share), the plan limits with the quiet absent state, and the loading/error/empty states. Verify with
  a component test that the window and grain re-read the figures, that a subscription window omits
  cost, and that no account snapshot renders the absent state rather than a zeroed bar.

- [x] 3.2 Add the breakdowns and the model filter: stacked tokens-per-bucket by project, top tickets by
  cost or tokens, by-role and by-worker, runs per bucket, the model mix, and the project share, all
  from the same scoped query; a chosen model filters every figure and a visible control clears it; the
  knowledge-context section (average tokens per run, never-read documents, most-read documents) is
  shown scoped to the window. Verify with a component test that choosing a model re-queries with the
  model scope, that cost-labelled breakdowns label cost only when billed, and that the knowledge
  section renders its figures.

## 4. Changelog at `/v2/w/$ws/changelog`

- [x] 4.1 Build `packages/ui/src/v2/changelog/ChangelogPage.tsx` in the `V2Page` frame: the year
  heatmap (`ActivityHeatmap`) over the newest-first timeline grouped by day, week and month from
  `groupTimeline`, each entry showing its time, kind (reusing `KIND_LABEL`/`KIND_TONE`), summary and
  actor, linking a ticket entry to its V2 ticket page and opening a pull-request entry on the forge.
  Verify with a component test that a ticket entry links under `/v2/w/$ws/tickets/…`, a pull-request
  entry opens externally, and no entries renders the empty state.

- [x] 4.2 Add loading older entries and the heatmap jump: choosing a heatmap day loads until that day
  is covered and then moves the timeline to it, and the list says when the whole record is shown.
  Verify with a component test that asking for older appends a page, that a heatmap day not yet loaded
  triggers `loadUntil` before scrolling, and that the final state says the record is complete.

## 5. Project overview at `/v2/w/$ws/p/$project`

- [x] 5.1 Build `packages/ui/src/v2/project/ProjectPage.tsx`: resolve the address against `useProjects`
  by slug or id, render the `V2Page` frame with the project label and the header actions linking to
  the project's Work, Knowledge and Chat V2 destinations (no merge queue, and no separate Specs link —
  V2 has no specs route), and show an empty state naming an address that resolves to no project.
  Verify with a component test that a slug and an id both resolve, that the three header links point
  under `/v2`, and that an unknown address shows the empty state.

- [x] 5.2 Add the About block and Current focus: the git URL, default branch, delivery mode (with
  inherited marker) and sync state, and the project knowledge file's Current focus when it has one.
  Verify with a component test that the identity fields and delivery mode render, and that a knowledge
  file without a Current focus renders nothing extra.

- [x] 5.3 Add the History section over `useProjectHistory` and `layoutGraph`: the commit lanes, ref
  badges, opening a commit's detail, and the load-more control, restyled to V2. Verify with a
  component test that the graph rows render with their lanes and that choosing a commit opens its
  detail.

- [x] 5.4 Add the Pull requests section over `usePullRequests`/`usePullRequest` and the shared diff
  renderer (`usePullRequestDiffFiles`/`File`/`Context`, `DiffHunks`, `useDiffLayout`,
  `highlightLine`): the open and recent groups, opening a pull request to its description, checks and
  files, and the unified/split layout with per-file hunks. Verify with a component test that opening a
  pull request renders its files through the shared renderer and that returning to the list works.

- [x] 5.5 Add the remaining sections over the same hooks and pure models: Needs you
  (`decisionsForProject`), Work under way (`filterTickets`/`foldBoard`, live and paused workers,
  last line), Recent landings (`recentLandings`), Activity (`useChangelogRecent`/`useChangelogHeatmap`,
  linking the full changelog) and Knowledge (`knowledgeSections`, linked documents, knowledge health).
  Verify with a component test that each section renders its data or its own empty state.

- [x] 5.6 Replace the four placeholders in `packages/ui/src/v2/pages.tsx` (`V2ChatsPage`,
  `V2UsagePage`, `V2ChangelogPage`, `V2ProjectPage`) with the real screens' page components. Verify
  with the `v2router` route test that each V2 route renders its real screen, not a placeholder.

## 6. Verification

- [x] 6.1 Run `pnpm lint` and `pnpm typecheck`; both clean.

- [x] 6.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.

- [x] 6.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed, and
  that V1 at `/` and its tests are untouched, including V1's Global Chats, project overview, Usage and
  Changelog behaviour and their stored keys.

- [x] 6.4 Run `openspec validate vs-352-weave-v2-ui-the-v1-screens-the-design-le --json --strict` and
  confirm it is clean.

- [ ] 6.5 Treat the acceptance list as the exit criteria: each screen shows the same real data and
  behaviour as its V1 counterpart in V2 styling; Global Chats panes resize, collapse and reorder and
  remember their layout; the project overview sections all render with working PR diffs; tests cover
  the Global Chats layout actions and each screen rendering its data at its V2 route; each screen
  diffed by eye against the nearest captured shots captain named on the ticket (`shots/01-chat` for
  Global Chats, `shots/03-work` and `shots/04-ticket` for the project pages, `shots/11-runs` for
  Usage's tables, `shots/18-design-notes` for the status set) in all four modes.
