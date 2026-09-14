# V2 shell bugs: sidebar projects, the Live shell, and the rail counts

Tracker change for [VS-366](weave://tickets/VS-366). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain's first real use of V2 at `/v2` found three shell defects, all frontend-only:

1. **Every workspace group lists the current workspace's projects.** `V2Shell` fetched only the
   active workspace's projects (`useWorkspaceProjects(ws ? [ws] : [])`) and `WorkspaceGroups` rendered
   that one array under every group, with `siblingIds` also taken from it — so the hues were computed
   against the wrong siblings too.
2. **Live renders without the rail.** `v2LiveRoute` was created with `getParentRoute: () =>
   v2RootRoute`; VS-353 re-parented the other V2 children under the pathless `v2ShellRoute` but Live
   keeps its own `createRoute` for the `?worker=` search passthrough, so it was missed.
3. **The rail shows no Live count, and Needs you is unreliable.** `useV2Counts` called
   `useWorkers({})`, which resolves its workspace from a `WorkspaceProvider`; the shell (rail and
   header) sits *outside* `V2Workspace`'s provider, so the query is disabled everywhere and the Live
   count is always 0. Needs is a separate fact in the rail's global and per-workspace rows, and does
   not match the decisions the Needs screen renders.

## What changes

- `packages/ui/src/v2/V2Shell.tsx`: fetch the projects of **every** workspace the rail lists and
  render each group from its own list, computing that group's `siblingIds` from its own projects.
- `packages/ui/src/router.tsx`: parent `v2LiveRoute` under `v2ShellRoute`, keeping the search
  passthrough. Audit the other non-`v2GlobalRoute`/`v2WsRouteFor` V2 routes: only the index redirect
  and `/v2/login` sit beside the shell, both intentionally.
- `packages/ui/src/v2/V2Page.tsx`: `useV2Counts` fans out across the workspaces —
  `useWorkersMany(ids)` for the daemon-wide Live count and `useDecisionsMany(ids, {status: 'open',
  owner: 'human'})` for each workspace's Needs-you count and their global sum — falling back to the
  listed `needsYou` until the decisions land. A scope-aware `countOf` picks the global figure for an
  Everywhere row and the workspace's own for a workspace row. The shell mirrors V1's global-page
  `FanInStreams` when the route names no workspace, so the counts invalidate live.
- Tests: a two-workspace sidebar test (each group lists only its own, from either screen), a router
  test that no V2 destination except `/v2/login` sits beside the shell, and a rail-count test from
  seeded workers and decisions with no interaction.

## Out of scope

V1 at `/` is untouched. No daemon or API change; only existing hooks are reused. The phone tab bar,
the merge queue and every V2 screen body are unchanged.
