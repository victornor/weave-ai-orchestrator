## 1. Desktop rail — New project under each open group's projects

- [x] 1.1 In `packages/ui/src/app/WorkspaceNav.tsx`, stop `ProjectsGroup` returning null when the
      workspace has zero projects (or no fetch state yet). When the parent group is open, always
      render the projects region; keep the existing loading / error / project-row branches; put a
      "New project" link last, using `PlusGlyph`, labelled "New project", addressing
      `/w/$ws/settings` with `search: { section: 'projects' }` for that group's workspace id.
- [x] 1.2 Extend the `A` mock in `packages/ui/src/test/workspacenav.test.tsx` to surface `search`
      (same `data-search` pattern as `moreSheet.test.tsx`) so the New project href is assertable.
- [x] 1.3 Cover: New project present under an open group that has projects; present for a
      genuinely empty open group (replace the current "no project block" assertion); present while
      loading and after a failed fetch; absent from a collapsed group; a non-active open group's
      control addresses that workspace, not the active one; the plus mark is the same `PlusGlyph`
      New workspace uses. Do not change the New workspace tests.

## 2. Phone More sheet — same control where projects are shown

- [x] 2.1 In `packages/ui/src/app/MoreSheet.tsx`, always render the Projects region (not only when
      `projects.length > 0`). Keep listing the active workspace's projects as today. Add a
      "New project" control under those rows, same `PlusGlyph` and label as the rail, linking to
      `/w/$ws/settings` with `search: { section: 'projects' }`, dismissing the sheet on activate.
- [x] 2.2 In `packages/ui/src/test/moreSheet.test.tsx`, replace "contributes no block at all for a
      workspace with no projects" with: the Projects region is present, has no project rows, and
      offers New project. Add: with projects, New project sits under them; activating it dismisses
      the menu and addresses Settings Projects of the active workspace.

## 3. Verification

- [x] 3.1 `pnpm typecheck && pnpm lint && pnpm --filter @agent-conductor/ui exec vitest run` green.
      Existing Settings, AppShell, and New workspace tests stay passing.
