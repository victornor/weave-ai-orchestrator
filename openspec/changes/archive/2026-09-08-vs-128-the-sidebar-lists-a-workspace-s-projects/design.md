## Context

`WorkspaceNav` (`packages/ui/src/app/WorkspaceNav.tsx`) is purely presentational — `AppShell` owns
every hook and passes plain data down, which is what lets both be unit-tested without the wholesale
`api/hooks` mock. Today `AppShell` calls `useProjects()` once, for the active workspace (`useWs()`),
and hands the single resulting array straight to `WorkspaceNav`'s `projects` prop, which the
component only ever renders next to the active group (`active && projects.length > 0`).

`api.ws<Project[]>(workspace, '/projects')` and its query key `qk.projects(ws)` already take an
explicit workspace id — nothing in the client or the route is active-workspace-specific. `useProjects()`
is just the one place that always calls it with the active id. The daemon route answers for any
workspace id already; no server change is needed.

Expansion state (`expanded: string[]`) is owned by `AppShell` and persisted to `localStorage`
(`lib/wsExpansion.ts`), including across reloads — so a workspace can already be "expanded" on
mount from a previous session, and its projects must be fetched then too, not only on a click.

## Goals / Non-Goals

**Goals:**
- Fetch a workspace's projects exactly when its group is first open (active on mount, or expanded by
  the human), and reuse the fetch on subsequent expansions.
- Keep `WorkspaceNav` presentational: it receives per-workspace state, it does not fetch.
- Isolate one workspace's fetch failure from the rest of the rail.

**Non-Goals:**
- Changing `MoreSheet` (the phone sheet) — it already only ever shows the active workspace's
  projects and the spec for it is untouched.
- Changing how the Needs-you counts are fetched or refreshed.
- A new API route or response shape — `GET /api/w/:ws/projects` is reused as is.

## Decisions

**One hook, `useProjects` extended to accept a target workspace, fanned out with `useQueries`.**
`AppShell` computes the set of workspace ids that need their projects — the active workspace plus
every id in `expanded` — and passes that set to a new hook, `useWorkspaceProjects(ids: string[])`,
built on TanStack Query's `useQueries` over `qk.projects(id)` / `api.ws<Project[]>(id, '/projects')`
per id, each with `enabled: true` only because `ids` itself is already the filtered set (a workspace
not in `ids` gets no query object at all — that is what keeps a never-opened workspace's projects
unfetched). The result is reduced to `Record<string, { status: 'pending' | 'error' | 'success';
projects: Project[] }>` and passed to `WorkspaceNav` as a new `projectsByWs` prop, replacing the old
single `projects` array prop.

Alternative considered: keep `useProjects()` for the active workspace and add a second, separate
per-workspace hook only for expanded non-active ones. Rejected — it doubles the data path for what
`WorkspaceNav` treats as the same concept (a group's project list), and the active workspace would
need special-casing in two places instead of one call site in `AppShell` building one `ids` array.

**Caching is TanStack Query's own, not hand-rolled — but needs `staleTime: Infinity`.** Once a
workspace id has been queried, `useQueries` keeps serving its cached result from the same
`queryKey`. Dropping a workspace out of `ids` (group collapsed) removes its observer; TanStack
Query's default `staleTime: 0` means an id that re-enters `ids` (re-expanded) is treated as stale
and refetched on remount even though the cached data never left the cache. `staleTime: Infinity` on
each per-workspace query is what actually satisfies "collapsing and re-expanding does not refetch" —
confirmed by a test that counts requests across a collapse/re-expand cycle
(`useWorkspaceProjects.test`) before this was added.

**`MoreSheet`'s existing `projects: Project[]` prop for the active workspace is untouched.** It never
shows a non-active workspace's projects (see the phone requirement, out of scope here), so `AppShell`
keeps deriving it from `projectsByWs[activeWs]?.projects ?? []` — one array slice, not a second fetch
path.

**Clicking a non-active workspace's project switches the active workspace via the navigation itself,
not a separate "switch" step.** The project link already carries `params: { ws: w.id, project: p.slug
}` for its own (non-active) workspace id `w.id` — `WorkspaceNav` needs no new click handler, since
following that link already changes the route's `:ws` param, and the app's active-workspace state is
derived from the route (`useWs()` / `summary.data?.workspace.id`) rather than tracked separately. This
is why the requirement text says "as part of the same navigation" rather than describing a second
action.

## Risks / Trade-offs

[A workspace with many projects, expanded and left expanded, keeps its query cached and refetched on
window refocus like any other TanStack query] → same default behavior as every other list in this
app (tickets, roles, workers); no new risk, and refetch-on-focus is what keeps a stale list from
going unnoticed.

[`useQueries` with a per-render-computed `ids` array can identity-thrash the query list if `ids` is
rebuilt as a new array every render] → `AppShell` memoises `ids` (`useMemo`, keyed on `activeWs` and
`expanded`) the same way it already memoises `listed` and `commands`.
