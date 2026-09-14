# Design

## Where the counts come from

HANDOFF §15 requires every count to be derived from the same data the screen renders, and §4 puts
the counts on the global rail rows. The shell's rail is a layout above `V2Workspace`, so it has no
`WorkspaceProvider` and `useWorkers({})` / `useDecisions({...})` — both of which resolve their
workspace from that provider — are disabled there. `useV2Counts` must therefore fan out explicitly
across the workspace list.

- **Live** = `useWorkersMany(ids)` reduced with `liveWorkingAgents` (`provisioning`, `active`,
  `running`) — the same predicate the Live screen uses for its roster, so the rail figure and the
  header figure are one fact.
- **Needs you** = `useDecisionsMany(ids, {status: 'open', owner: 'human'})` — the array
  `V2NeedsScreen` renders. Each workspace's count is its own query's length; the global figure is
  their sum. Until those queries land, the listed `needsYou` (the daemon's own per-workspace count)
  is the fallback, so the badge is present on first paint rather than flashing to zero.

`countOf` chooses by the destination's `scopeKind`, not by the row's current route scope: an
Everywhere row always carries the global figure, a workspace row its own workspace's. That is what
lets the global `Needs you` row and a workspace group's `Needs you` shortcut coexist without
agreeing when they should not.

## The sidebar's projects

The rail shows every workspace group open by default, so the shell fetches every listed workspace's
projects (`useWorkspaceProjects(list.map(w => w.id))`) rather than only the active one — exactly the
fan-out `LiveBody` already does. `WorkspaceGroups` reads `projectsByWs[w.id]` per group and derives
that group's `siblingIds` from the same array, so a project's hue is stable whether it is rendered in
its own workspace's screen or another's.

## Live coverage

V1 opens `FanInStreams` for the listed workspaces on a global page; V2's shell had no equivalent, so
a global page's counts (and Live's own roster) only moved on a focus refetch, which the app disables.
The shell renders `FanInStreams` when `workspaceFromV2Path` returns `null` — the global pages — and
leaves the per-workspace stream to `V2Workspace`'s provider on `/v2/w/*` pages, avoiding a duplicate
connection for the active workspace.

## The Live route

`v2LiveRoute` was built with its own `createRoute` for the `?worker=` passthrough and kept
`v2RootRoute` as its parent when VS-353 re-parented the other children under the pathless
`v2ShellRoute`. Moving its parent is the whole fix; the `validateSearch` passthrough stays. The index
redirect and `/v2/login` remain direct children of `/v2` on purpose — one is a redirect with no
chrome, the other is the chromeless sign-in screen.
