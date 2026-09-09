## Why

The rail already has a "New workspace" control, but an expanded workspace's project list has no
matching way to add a project. Adding one today means knowing to open Settings → Projects and find
the form. Captain asked for a "New project" control under the workspace's projects, in the same
visual language as "New workspace", that takes the user to that existing Settings form — including
on a phone, where the rail is not shown.

## What Changes

- Every expanded sidebar workspace group shows a "New project" control under that group's project
  rows, using the same plus mark as "New workspace". Activating it navigates to that workspace's
  Settings at the Projects section, where the add-project form already lives. No git-URL form is
  added to the sidebar.
- A workspace with zero projects still shows the control. Today's `ProjectsGroup` returning null
  when empty must not hide it.
- On a phone, the same control is reachable in More where that workspace's projects are shown, even
  when the workspace has no projects yet. Activating it dismisses the menu and opens Settings
  Projects.
- New workspace is unchanged. The Settings add-project 400 (VS-153) is unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: an expanded workspace group offers a New project
  action under its project list, navigating to that workspace's Settings Projects section; a
  workspace with no projects still shows the action; the phone's More menu carries the same action
  where that workspace's projects are shown.

## Impact

- `packages/ui/src/app/WorkspaceNav.tsx` (`ProjectsGroup` always renders when the group is open;
  New project link under the rows).
- `packages/ui/src/app/MoreSheet.tsx` (Projects block always present, with New project).
- `packages/ui/src/test/workspacenav.test.tsx` and `packages/ui/src/test/moreSheet.test.tsx`.
- No server, API, CLI, or Settings form changes. Navigation uses the existing
  `/w/$ws/settings?section=projects` contract.
