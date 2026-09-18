# Design — restoring mobile workspace switching and removing the V1 affordance

## Context

See `proposal.md` — Why. The state this design works against:

- The phone shell is `V2Shell.tsx`. Its rail (`<aside>`) is `hidden … md:flex`, so at phone width
  only the bottom tab bar and the **More** sheet (`MoreList`) remain. `MoreList` renders the
  Everywhere group, then a single group titled with the *current* workspace's name holding that
  workspace's sections, then the current workspace's projects, then the theme switch and an
  `Open V1` row.
- The desktop rail has a complete `WorkspaceGroups` component that expands every workspace into its
  sections. There is no phone equivalent.
- The mobile switcher used to be V1's `app/MoreSheet.tsx`, a **Workspaces** section that linked each
  workspace to `/w/<id>/needs`. It was reachable on a phone because V1 owned the mobile app.
  **VS-456** (`02283f2c`, 2026-09-15) promoted V2 to `/` and unmounted the V1 route tree, so a phone
  began landing on V2 — which never had a switcher. **VS-457** (`7fd2bc07`, 2026-09-15) then deleted
  `MoreSheet.tsx`, `AppShell.tsx` and `WorkspaceNav.tsx` outright. Both commits are named in the PR.
- `Open V1` is the only V2→V1 control in the tree: a repo-wide grep for V1 affordances finds it in
  `V2Shell.tsx:454` and its assertion in `v2shell.test.tsx`. It links to `/`, which is now V2's own
  root, so it is a self-link to a version that answers no URL.
- The shell already holds everything the switcher needs: `useWorkspaces()` gives `list`, and
  `useV2Counts(scope).needsByWs` gives each workspace's open Needs-you count (falling back to the
  listed `w.needsYou`). No new hook or data fetch is required.

## Goals / Non-Goals

**Goals**

- A phone can change workspace in two taps from any screen: **More**, then the workspace.
- The switcher's existence is pinned by a UI test, so it cannot silently regress again.
- No V2 surface offers a switch to V1, with a test that also pins that.
- Rendered evidence at phone width (light and dark) and desktop.

**Non-Goals**

- No change to the desktop rail, to V1's modules, or to the retired-address redirect table.
- No new route, daemon endpoint, config or migration.
- Not a general shell redesign; the new control lives in the existing More sheet.

## Decisions

### 1. The switcher is a **Workspaces** group at the top of the phone More list

`MoreList` gains a `Workspaces` group, rendered above the current workspace's sections, listing every
workspace from `useWorkspaces()`. Each row carries the workspace name and its open Needs-you count
and marks the current workspace. Tapping a row navigates to `/w/<id>/needs`, switching scope in one
navigation.

*Why the More list:* it is already the phone's "everything the tabs leave out" surface, so the
switcher needs no new chrome and the two-tap budget holds (More is one tap from any screen; the row is
the second). The ticket explicitly allows the menu.

*Why `/w/<id>/needs` as the destination:* it is exactly where the app lands a workspace with no
section named (`/` and `/w/$ws` both redirect there), and it matches V1's deleted `MoreSheet`
precedent. Preserving the current section across a switch (e.g. Work → Work) was considered and
rejected: the phone tabs mix workspace-scoped and global destinations, so "the same section" is not
always a workspace screen, and the canonical landing is honest and predictable.

*Why a dedicated row rather than `MoreRow`:* `MoreRow` renders a `V2Dest`; a workspace is not one and
navigates by id to a computed address. A small presentational row in `V2Shell.tsx` keeps the change
local and the existing `MoreRow`/`MoreGroup` styling is reused.

### 2. The desktop `WorkspaceGroups` is left alone

The desktop rail keeps its expandable workspace sections; the phone gets the flat switching list. The
two share only the `useWorkspaces` data and the count source, so they cannot disagree about a
workspace's name or Needs-you count.

### 3. The `Open V1` row is deleted, and the audit is a grep plus a negative test

The `<A to="/">Open V1</A>` block is removed. A repo-wide grep confirms it is the only V2→V1
affordance; the existing `v2shell.test.tsx` assertion that `Open V1` is present flips to assert it is
absent, and no V2 surface is left linking V1. V1's modules and the router's retired-address redirects
are untouched: removing an affordance is not removing the version.

## Risks / Trade-offs

- **The More list grows and could feel long.** → The Workspaces group sits above the current
  workspace's own group; it is a short list (the daemon's workspaces) and the sheet already scrolls.
- **A workspace name could collide with a section label in the sheet's text queries.** → The group
  carries its own title and the rows are addressable by their `/w/<id>/needs` href in the test, not by
  bare text.
- **The switcher regresses again if only the More list changes.** → The added test mounts the shell
  and finds the switcher in the rendered More sheet, exactly the "renders the mobile shell and finds
  the switcher" the ticket asks for.
- **Screenshot harness gotchas** (Tailwind `@source`, `/auth/me` stub, `VITE` root at
  `packages/ui`) are documented in `docs/ui-screenshot-harness.md` and the project KB; the captures
  follow that recipe. Review captures go outside the worktree and are attached to the ticket.

## Migration Plan

Frontend-only. No data or config change. Deploy is the normal UI build served by the daemon; rollback
is a revert of the single commit.

## Open Questions

None.
