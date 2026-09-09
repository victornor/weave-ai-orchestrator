## Context

See `proposal.md` for motivation. The desktop rail (`WorkspaceNav.tsx`) lists every workspace; an
open group shows section links then `ProjectsGroup`. `ProjectsGroup` returns `null` when the fetch
has not started or completed with zero projects, so an empty workspace has no project block at all.
"New workspace" sits at the bottom of the rail, a button that opens onboarding (`onNewWorkspace`).

The phone has no rail. `MoreSheet` lists leftover destinations, then a Projects block that is
omitted when `projects.length === 0`, then workspaces plus "New workspace".

Adding a project today is Settings → Projects (`?section=projects`). The add-project form is the
first card of that section. VS-153 is separately fixing that form's autoMerge 400 and is out of
scope.

## Goals / Non-Goals

**Goals:**
- A New project control under each expanded group's project rows, same plus mark as New workspace.
- Activating it opens that workspace's Settings at the Projects section (existing URL contract).
- Empty, loading, and failed project fetches still show the control.
- The same control is reachable from the phone's More menu without the desktop rail.

**Non-Goals:**
- An inline git-URL form in the sidebar or More sheet.
- Changing New workspace or onboarding.
- Fixing the Settings add-project 400 (VS-153).
- A new Settings section, area, or query parameter.
- Fetching projects for a group that has never been expanded, just to show New project — the
  control belongs on an *open* group, which already fetches.

## Decisions

### The control is a link, not a callback

New workspace is a button because it opens the onboarding overlay. New project is navigation to a
route the app already has, so it is an `<A>` to `/w/$ws/settings` with `search: { section:
'projects' }`, the same pattern the More sheet already uses for Updates. No new `onNewProject` prop
on `WorkspaceNav` or `MoreSheet`. Following the link in a non-active workspace's group switches
that workspace into context the same way a project link already does (the href carries that
workspace's id).

### No extra focus/hash parameter

The add-project form is already the first card of the Projects section, and Settings shows only the
selected section. Arriving at `?section=projects` puts the form in view without scrolling. A
`focus=add` query or `#add-project` hash would be a new URL contract for a case the layout does not
need. If the form later moves below the project list, that is a follow-up.

Do not focus the Git URL input on every visit to Projects — the rail's Settings link also lands on
a section, and stealing focus there would be wrong. New project just navigates.

### Empty groups still render the project block

`ProjectsGroup` currently `return null` when `!state || (success && length === 0)`. After this it
renders whenever the parent group is open: loading and error rows stay as they are, project rows
when there are any, and New project always last. The `aria-label="${wsName} projects"` region is
therefore present for an empty workspace too; tests that asserted the region was absent must assert
"no project rows, New project present" instead.

Collapsed groups still show neither the project list nor New project.

### Phone: the Projects block is always there

"A workspace with no projects SHALL contribute no project block" is changed: More always shows the
Projects region for the active workspace, with New project under any project rows. A workspace with
projects still lists them as today. Activating New project dismisses the sheet (same `onClose` as
every other destination) and navigates to the active workspace's Settings Projects section.

More still only shows the *active* workspace's projects, so New project there adds to the active
workspace. Other workspaces' projects are not in More today; this change does not add them.

### Same plus mark, same density as New workspace

Reuse `PlusGlyph`. Label "New project". Accessible name is that text (a link or a button, not an
icon-only control). Visual treatment matches New workspace: plus + meta-size muted label, not a
primary button.

## Risks / Trade-offs

- **The workspacenav link mock does not pass `search` through.** More's mock already does
  (`data-search`). The rail test must extend its `A` mock the same way, or the New project href
  assertion cannot see `section=projects`.
- **Empty-workspace tests invert.** `workspacenav.test.tsx` ("no project block") and
  `moreSheet.test.tsx` ("contributes no block at all") become wrong and must be rewritten, not
  deleted — they are the regression for "New project still shows".
- **VS-153's Settings form 400 is still there.** New project will land the human on a form that can
  still fail to submit. Out of scope; do not paper over it in the sidebar.

## Migration Plan

UI-only. No schema, no API, no docs/API.md change. Rollback is reverting the two components and
their tests.
