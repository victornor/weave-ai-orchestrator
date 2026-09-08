## Why

The sidebar only ever fetches the active workspace's projects, so expanding another workspace's
group cannot show its projects — nothing has fetched them. Switching workspace is currently the only
way to find out what a workspace contains. Captain asked for the projects to always be reachable from
the sidebar (2026-09-08).

## What Changes

- Expanding any workspace's group in the desktop sidebar fetches and lists that workspace's
  projects, not only the active workspace's.
- A workspace's projects are fetched once, the first time its group is expanded, and kept from then
  on — collapsing and re-expanding does not refetch.
- A group whose projects are still loading renders a distinguishable loading state rather than
  looking empty; a workspace that genuinely has no projects still shows nothing extra, as today.
- A failed project fetch is scoped to that one group: it shows a failed state and the rest of the
  rail, including other expanded groups, is unaffected.
- Clicking a project belonging to a non-active workspace switches the active workspace to it as part
  of navigating to the project, so the rail and the content never disagree about which workspace is
  showing.
- The active workspace's own project list, the Needs-you counts, and the keyboard shortcuts are
  unchanged.
- Out of scope: the phone "More" sheet's project list (it shows the active workspace's projects only,
  per `workspace-navigation/sidebar-workspaces`'s phone requirement, which this change does not
  touch), and the Needs-you count freshness for non-active workspaces.

## Capabilities

### Modified Capabilities
- `workspace-navigation/sidebar-workspaces`: the "workspace group lists its projects" requirement
  changes from "the active workspace only" to "any expanded workspace, fetched on first expansion,
  with loading and error states distinguished from empty".

## Impact

- `packages/ui/src/app/WorkspaceNav.tsx` — render per-workspace project state (loading / error /
  ready) for every open group, not just the active one.
- `packages/ui/src/app/AppShell.tsx` — fetch a workspace's projects when its group is first expanded,
  in addition to the always-fetched active workspace.
- `packages/ui/src/api/hooks.ts` / `packages/ui/src/api/keys.ts` — a hook that fetches projects for a
  set of workspace ids, reusing the existing `/w/:ws/projects` route and `qk.projects(ws)` cache key
  per workspace (already parameterised by workspace, just never called for more than one workspace at
  once today).
- `packages/ui/src/test/workspacenav.test.tsx` and `packages/ui/src/test/appshell*.test.tsx` — cover
  the new per-workspace states.
- No server or API changes: `GET /api/w/:ws/projects` already answers for any workspace id.
