# Design — one role chat button per role under each project

## Context

See `proposal.md` — Why. The state this design works against:

- `packages/ui/src/v2/V2Shell.tsx` renders the desktop rail (`WorkspaceGroups` → `ProjectRow`) and the phone More list (`MoreList` → `ProjectRow` from one component) from `nav.ts`. `ProjectRow` today renders the project row and one child row, **Roadmap**. `packages/ui/src/index.css` styles a child row with `.v2-row-child`.
- The shell sits **above** `V2Workspace`'s `WorkspaceProvider` (`V2Root.tsx`): on a global page there is no provider at all, and on a workspace page the provider is below the shell, inside the outlet. A sidebar row therefore cannot call `useWs()`.
- The shell already renders every listed workspace's projects by fetching per workspace (`useWorkspaceProjects(ids)`, `useWorkspacePlugins(ids)`, `useWorkersMany(ids)` inside `useV2Counts`).
- A role's session is opened by `usePersistentSession` through `RoleChatControl` (`packages/ui/src/v2/roleChat.tsx`), which calls `useWs()` and `usePersistentSession()` — both of which assume the current workspace. `roleChatBlockedReason(role)` is the one source for why a role cannot chat.
- `useRolesMany(ids)` returns every role of each workspace (all projects); `useWorkersMany(ids, { kind: 'session' })` returns each workspace's persistent sessions. `WorkerListItem` carries `roleId` and `projectId`, so a role's session can be found without a new endpoint.

## Goals / Non-Goals

**Goals**

- One actionable row per role under each project's Roadmap row, in the rail and in the phone More list (the same component), opening that role's persistent conversation directly.
- The role states are honest and the many-roles case stays tidy.
- One open-or-resume implementation, shared by all three surfaces.
- Rendered evidence at desktop and phone width, both themes.

**Non-Goals**

- No change to how a session is created, resumed or dispatched (`persistent-sessions` untouched).
- No new route, daemon endpoint, config or migration; no new live indicator.
- No redesign of the Roles screen or the project overview Roles section; they keep their door.

## Decisions

### 1. The shell fetches roles and sessions per workspace, and passes them down

`V2Shell` calls `useRolesMany(ids)` and `useWorkersMany(ids, { kind: 'session' })` once each for the listed workspace ids, groups them by `projectId` and `roleId`, and passes `rolesByProject` / `sessionByRole` into `WorkspaceGroups` and `MoreList`. `ProjectRow` gets that project's roles and their sessions.

*Why not a hook per `ProjectRow`:* one query per project is more requests than one per workspace, and the shell already fetches every other cross-workspace dataset this way. *Why not extend `useV2Counts`:* counts are a different concern and its lists are already consumed for the Live/Needs badges.

### 2. One open-or-resume helper, two presentations

`roleChat.tsx` gains `useRoleChatOpen(ws?)` holding the `usePersistentSession` mutation and the navigation to `/w/$ws/workers/$workerId`. `RoleChatControl` (text button, Roles screen and overview) and the new `RoleChatRow` (sidebar child row) both call it; neither re-implements the open. The pure helpers (`roleChatBlockedReason`, `sessionForRole`, and a new `roleNavRows` for cap/visibility) are exported for unit tests.

### 3. `usePersistentSession` takes an explicit workspace

The hook's mutation currently resolves `useWs()`; a sidebar row may belong to a workspace the app is not currently showing, and on a global page there is no provider to resolve at all. `usePersistentSession(wsOverride?)` resolves via `useHookWs(wsOverride)` and invalidates that workspace's worker cache. The override is optional, so the existing callers (inside a provider) are unchanged. Without this, clicking a role under a non-current workspace would open the session in the wrong workspace — or throw.

### 4. A role that cannot chat is shown disabled, with its reason

Blocked roles (paused, retired, awaiting hire approval) are still listed, as a non-interactive child row: the role name plus the short state label, with the full `roleChatBlockedReason` as the row's title and accessible name. Hiding them was the alternative; it was rejected because it makes the roster silently incomplete and because the ticket's own evidence list asks for a paused role to be visible in the sidebar capture. An active role is a `<button>`; a blocked one is a static, non-focusable row, so it never offers a click that fails. This mirrors `RoleChatControl`, which states the reason rather than rendering a failing control.

*Why not visible full reason text:* the rail is 194px and the reason ("Retired — no longer available to chat") does not fit in a 12px child row; the state label is visible and the reason is on hover and in the accessible name.

### 5. Cap at five shown rows plus a `+N more roles` row

A project with more than five roles shows the first five, then one child row naming how many are not shown that links to that project's overview (where the full Roles list is). The role whose session is the current page is always included, even beyond the cap, so opening a conversation never hides its own row. A project with no roles adds nothing.

*Why a cap:* the ticket asks that a project with several roles stay tidy; five keeps a project's block bounded while every role stays reachable one row away. *Alternatives:* no cap (the rail scrolls, but a twelve-role project floods the block and its neighbours), and expand-in-place (new per-project state the ticket did not ask for).

### 6. The open conversation is marked, but not as a second `aria-current` page

When the shown page is a role's persistent session, that role's row gets a `.v2-row-child-current` style and `data-role-chat-current="true"`. It is deliberately **not** `aria-current="page"`: the navigation spec requires exactly one highlighted rail row, and on a session page that row is the owning **Roles** destination (`activeNavKey` maps `/workers` to `ws-roles`). The child row is a secondary mark of the open conversation, mirroring how the Roadmap child row carries no current state of its own.

### 7. No live indicator is added

Checked: no navigation row carries a per-row live indicator — the rail's marks are counts on destination rows and the collapsed rail's dot is Needs-you only. Adding one to the role rows would be inventing an indicator the ticket explicitly forbids, so a working session is left to the existing Live screen, the worker page and the header pill.

## Risks / Trade-offs

- **The rail grows with projects × roles.** → The cap bounds each project; the rail already scrolls (`.v2-rail-scroll`).
- **More queries per workspace.** → Two per workspace, of the same shape and cadence as the existing project/plugin/count queries; no polling beyond the app's normal query staleness.
- **A role row in a non-current workspace opening in the wrong workspace.** → Decision 3: the workspace is passed explicitly from the row's own project.
- **Two visual emphases on a session page (Roles destination row and the role child row).** → Accepted and stated in Decision 6; only one carries `aria-current`.
- **Blocked rows convey the full reason only on hover / to assistive tech.** → The short state label is visible, and the reason is the row's title and accessible name, matching the existing control's wording source.
- **Tests must not encode a guessed DOM shape.** → Row states are asserted through roles (`button` vs non-actionable row), accessible names and the shared `data-role-chat-*` hooks, all driven by the exported helpers.

## Migration Plan

Frontend-only. No data, API or config change. Deploy is the normal UI build served by the daemon; rollback is a revert of the change's commits.

## Open Questions

None.
