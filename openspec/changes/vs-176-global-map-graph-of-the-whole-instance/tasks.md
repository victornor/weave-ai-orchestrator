## 1. Chrome

- [x] 1.1 Register `/map` as a root sibling of `/needs`, `/live` and `/chats` in `packages/ui/src/router.tsx`, sharing chrome that renders without a `WorkspaceProvider`. Verify the router test navigates to `/map` without a `$ws` param.
- [x] 1.2 Add Map to `GLOBAL_NAV` after Chats (label Map, path `/map`). Teach `AppShell.onGlobalPage` to include `/map` so no workspace group is marked active, `setWorkspaceId` is not called, and `FanInStreams` run. Verify `workspacenav.test.tsx` shows Map in the global section above the list, marks it current on `/map`, and leaves the remembered workspace unchanged.
- [x] 1.3 Add Global Map to the phone More menu with the other global destinations, without growing the five tabs. Verify `moreSheet.test.tsx` lists it, still asserts five tabs, and choosing it goes to `/map`.

## 2. Data fan-out and model

- [x] 2.1 Let `useRoles`, `useKnowledgeIndex` and `useConductor` take an optional workspace id that overrides `useWs()`, and add `useRolesMany` / `useKnowledgeIndexMany` (or equivalent) in the `useWorkersMany` pattern. Verify existing team/knowledge tests still pass, and that a call with an explicit id hits `api.ws` for that id.
- [x] 2.2 Implement `buildMapModel` as a pure function: workspace / project / conductor / non-retired role / in-flight ticket / per-project knowledge nodes and the ownership edges from the spec. Verify a unit test covers two workspaces, a todo ticket excluded, a done ticket excluded, a retired role excluded, one knowledge node for a project with several files, no worker nodes, unassigned blocked ticket hanging off its project, and no cross-workspace edges.

## 3. Map page

- [x] 3.1 Build `/map`: fan-out the hooks per listed workspace, draw the graph with `lib/graph/` simulation + zoom/pan/fit + label counter-scale + workspace hulls + kind legend, start fitted. Verify a new `globalMap.test.tsx` shows nodes for two workspaces' projects/roles/in-flight tickets/knowledge, excludes todo/done/retired, shows an empty workspace as a lone workspace node with no error, shows one workspace failing while the other renders with retry, distinguishes loading from empty, and does not load the graph renderer on an unrelated page.
- [x] 3.2 Selecting a node opens a detail panel; the open action (and double-click) navigates to the spec's target in that node's workspace and makes it active. Verify the test follows a ticket node to `/w/{ws}/tickets/{id}`, a project node to that project's overview, and that the map itself has no knowledge editor.
- [x] 3.3 Under the phone breakpoint the page defaults to the neighbour list (selected node + neighbours, hop on choose) with a control that switches to the canvas. Verify the phone media-query path in `globalMap.test.tsx` (or equivalent) shows the list, not the canvas, until the control is used.
- [x] 3.4 Honour `prefers-reduced-motion` (one-pass layout, no viewport tween) and draw every colour from design tokens. Verify a reduced-motion case settles without scheduling animation frames, and that the canvas uses token vars rather than raw hex (existing hex lint covers the latter).

## 4. Cover it

- [x] 4.1 Update `docs/PLAN.md` §21.1 so the global-section sentence includes Map (`/map`) with Needs you, Live and Chats. Verify the paragraph exists and still describes per-workspace pages as unchanged.
- [x] 4.2 `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green.
