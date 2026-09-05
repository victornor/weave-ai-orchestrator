## Why

The desktop rail shows one workspace at a time. A dropdown at its top switches the whole app: it
rewrites the remembered workspace, tears the SSE stream down and reopens it against the new
workspace, and empties every workspace-scoped query. With several workspaces in daily use, going
from one workspace's chat to another's board is two clicks through a menu and a full context
change, and there is no way to see that another workspace has something waiting without going
there.

The routes already carry the workspace (`/w/:ws/...`), so this is a navigation problem, not an
architectural one: every section of every workspace is already an addressable link.

## What Changes

- The desktop rail lists **every workspace the daemon has loaded**, each as a collapsible group
  whose body is that workspace's eight sections (Chat, Needs you, Board, Team, Runs, Usage,
  Knowledge, Settings). Each section is an ordinary link to `/w/<workspace>/<section>`.
- The workspace-switcher dropdown is **removed**. Its two jobs move into the rail itself: switching
  is now clicking any section of any workspace, and **New workspace** becomes a permanent entry in
  the rail footer.
- Expansion state is remembered per device in `localStorage`. The active workspace is always
  expanded so the current section is never hidden.
- Each workspace header carries its **open Needs-you count**. `GET /api/workspaces` gains a
  `needsYou` field per workspace so one polled request covers every workspace; the active
  workspace's badge keeps coming from its live, SSE-invalidated decisions query.
- Chat's **scroll position is kept per workspace** for the session, so returning to a workspace's
  chat lands where it was left rather than jumping. Unsent draft text is **not** part of this
  change: [VS-48](conductor://tickets/VS-48) owns composer draft persistence, keyed by workspace and
  thread and storage-backed, and two stores for the same text would compete.
- Phone keeps its five tabs for the active workspace; the workspace list, with the same counts,
  appears at the top of Settings — the More tab's target.
- Keyboard shortcuts (`1`–`7`, `,`) and the `⌘K` palette are unchanged: they act on the active
  workspace, and "Switch workspace" stays in the palette.

## Capabilities

### New Capabilities
- `workspace-navigation/sidebar-workspaces`: what the sidebar lists, how a workspace group expands
  and how that survives a reload, what navigating to another workspace's section does to the app's
  workspace context, and where the workspace list lives on a phone.
- `workspace-navigation/workspace-signals`: the per-workspace Needs-you count — what it counts,
  where it comes from for the active and the non-active workspaces, and how fresh it has to be.

### Modified Capabilities
<!-- None: no existing capability describes the shell's navigation. -->

## Impact

- `packages/ui/src/app/AppShell.tsx` — the rail is rebuilt around a workspace list; the dropdown
  goes. A new `app/WorkspaceNav.tsx` holds the group so it can be tested on its own.
- `packages/ui/src/app/nav.ts`, `api/hooks.ts`, `api/keys.ts`, `api/types.ts`, `api/events.ts` —
  a `needsYou` field on the workspace list, its refetch interval, and invalidation on decision
  events.
- `packages/ui/src/lib/` — a small per-device store for expansion state and a session store for
  chat scroll offsets.
- `packages/ui/src/routes/Chat.tsx` — the scroll offset is recorded and restored per workspace. The
  composer is left untouched, so this change does not collide with VS-48.
  `routes/Settings.tsx` gains the phone workspace list.
- `packages/server/src/routes/daemon.ts` — `GET /api/workspaces` returns `needsYou`.
  `docs/API.md` records it.
- `docs/design/DESIGN-CONTRACT.md` §3 — the rail description changes.
- No database change: the count is an indexed read over the existing `decisions` table.
