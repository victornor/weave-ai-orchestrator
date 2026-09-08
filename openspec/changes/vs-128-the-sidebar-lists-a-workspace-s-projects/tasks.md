## 1. Data layer

- [x] 1.1 Add a `useWorkspaceProjects(ids: string[])` hook in `packages/ui/src/api/hooks.ts`, built on
      `useQueries` over `qk.projects(id)` / `api.ws<Project[]>(id, '/projects')` per id, reduced to a
      `Record<string, { status: 'pending' | 'error' | 'success'; projects: Project[] }>`; verify with a
      unit test (or the AppShell/WorkspaceNav integration tests in tasks 3) that two ids produce two
      independent cached entries and that an id dropped from `ids` keeps its cached result.

## 2. WorkspaceNav

- [x] 2.1 Replace `WorkspaceNav`'s `projects: Project[]` prop with `projectsByWs: Record<string, {
      status: 'pending' | 'error' | 'success'; projects: Project[] }>`, and render, for every open
      group (active or expanded), that workspace's own entry: a loading indicator on `pending`, an
      error indicator on `error`, the project list on `success` with projects, and nothing extra on
      `success` with none. Verify with `packages/ui/src/test/workspacenav.test.tsx`.
- [x] 2.2 Update `workspacenav.test.tsx` for the new prop shape: expanding a non-active workspace with
      a `success` entry lists its projects; a `pending` entry shows loading and not empty; an `error`
      entry on one workspace does not affect a `success` entry on another that is also expanded; a
      `success` entry with zero projects shows no project block and no error.

## 3. AppShell wiring

- [x] 3.1 In `AppShell`, compute the memoised set of workspace ids whose projects are needed — the
      active workspace plus every id in `expanded` — and pass it to `useWorkspaceProjects`; pass the
      resulting map to `WorkspaceNav` as `projectsByWs` in place of the old `projects` prop. Verify
      `pnpm typecheck` passes with no remaining reference to the removed prop shape.
- [x] 3.2 Derive `MoreSheet`'s existing active-workspace `projects` prop and the command palette's
      scope-cycling from `projectsByWs[activeWs]?.projects ?? []` instead of the removed `useProjects()`
      call, so their behaviour is unchanged. Verify `packages/ui/src/test/appshell.test.tsx` still
      passes for the command palette's scope command and for `MoreSheet`'s project list.
- [x] 3.3 Add an `appshell.test.tsx` case (or extend an existing one) that expands a non-active
      workspace and asserts its projects are requested and rendered, and that collapsing then
      re-expanding it does not trigger a second request.

## 4. Navigation on click

- [x] 4.1 Confirm (with a test in `workspacenav.test.tsx`) that a project link for a non-active
      workspace carries that workspace's id as the route's `:ws` param, so following it switches the
      active workspace as part of the same navigation with no separate step and no dead end.

## 5. Verification

- [x] 5.1 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and confirm all green.
- [x] 5.2 Take a screenshot (per `[[ui-screenshot-harness]]` from the project knowledge base, or the
      running dev app) of two workspaces expanded at once, both listing their projects, for the PR.
