# Tasks

## 1. Each workspace group lists its own projects

- [x] 1.1 In `V2Shell`, call `useWorkspaceProjects` with every listed workspace id (not just the active one) and pass the per-workspace map into `WorkspaceGroups`.
- [x] 1.2 In `WorkspaceGroups`, render each group's projects from `projectsByWs[w.id]`, and compute `siblingIds` from that same group's projects so hues are per-workspace.

## 2. Live renders inside the shell

- [x] 2.1 In `router.tsx`, parent `v2LiveRoute` under `v2ShellRoute` while keeping `validateSearch` passthrough for `?worker=`.
- [x] 2.2 Audit the remaining non-`v2GlobalRoute`/`v2WsRouteFor` V2 routes and confirm only the index redirect and `/v2/login` sit beside the shell.

## 3. The rail's Live and Needs you counts

- [x] 3.1 `useV2Counts` fans out with `useWorkersMany(ids)` for the daemon-wide Live count (`liveWorkingAgents` statuses) so it works outside a workspace provider.
- [x] 3.2 `useV2Counts` derives each workspace's Needs-you count and the global sum from `useDecisionsMany(ids, {status:'open', owner:'human'})` — the same source the Needs screen renders — with the listed `needsYou` as the pre-load fallback.
- [x] 3.3 `countOf` shows the global Needs figure on Everywhere rows and the workspace's own on workspace rows, so the expanded rail, collapsed rail and phone More list agree with the header.
- [x] 3.4 The shell opens `FanInStreams` when the route names no workspace, so the counts invalidate live (mirrors V1's global pages).

## 4. Tests and green checks

- [x] 4.1 Extend `v2shell.test.tsx`: two workspaces with different projects, each group lists only its own from either workspace's screen; and the rail's Live and Needs you counts render from seeded workers and decisions without interaction.
- [x] 4.2 Extend `v2router.test.ts`: `/v2/live` is under the shell and no V2 destination except `/v2/login` sits beside it.
- [x] 4.3 `pnpm lint`, `pnpm typecheck` and both test suites green; both suite blocks pasted verbatim in the report.
- [x] 4.4 Open the PR and transition the ticket to `in_review`.
